package postgres

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

func (s *Store) InterviewDocument(ctx context.Context, user, id string) (interviews.Document, error) {
	v, err := s.Interview(ctx, user, id)
	return v.Document, err
}
func (s *Store) InterviewUpdates(ctx context.Context, user, id, epoch string, version int64) (interviews.Updates, error) {
	var out interviews.Updates
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, false)
	if err != nil {
		return out, err
	}
	out = interviews.Updates{Version: v.snapshot.Document.Version, Epoch: v.snapshot.Document.Epoch, Updates: []interviews.Update{}}
	if epoch != out.Epoch {
		return out, failure("document_changed", 409, "Question changed; open its current document")
	}
	if version < 0 || version > out.Version {
		return out, failure("invalid_input", 400, "Invalid document version")
	}
	rows, err := tx.Query(ctx, `SELECT client_id,changes FROM interview_updates WHERE session_id=$1 AND epoch=$2 AND version>$3 ORDER BY version LIMIT 256`, id, epoch, version)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var u interviews.Update
		if err = rows.Scan(&u.ClientID, &u.Changes); err != nil {
			return out, err
		}
		out.Updates = append(out.Updates, u)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	out.Version = version + int64(len(out.Updates))
	return out, nil
}
func (s *Store) PushInterviewUpdates(ctx context.Context, user, id, key string, p interviews.Push) (interviews.Updates, error) {
	var out interviews.Updates
	if len(p.Updates) == 0 || len(p.Updates) > 32 {
		return out, failure("invalid_input", 400, "Provide 1-32 document updates")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, true)
	if err != nil {
		return out, err
	}
	hash := interviewFingerprint(id+":updates", p)
	prior, data, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return out, err
	}
	if prior != "" {
		err = json.Unmarshal(data, &out)
		return out, err
	}
	if p.Epoch != v.snapshot.Document.Epoch {
		return out, failure("document_changed", 409, "Question changed; open its current document")
	}
	if p.Version != v.snapshot.Document.Version {
		return out, failure("stale_version", 409, "Pull document updates and retry")
	}
	source := v.snapshot.Document.Source
	for i, u := range p.Updates {
		if strings.TrimSpace(u.ClientID) == "" || len(u.ClientID) > 128 {
			return out, failure("invalid_input", 400, "Invalid editor client ID")
		}
		source, err = interviews.ApplyChanges(source, u.Changes)
		if err != nil {
			return out, failure("invalid_input", 400, err.Error())
		}
		if _, err = tx.Exec(ctx, `INSERT INTO interview_updates(session_id,epoch,version,client_id,changes) VALUES($1,$2,$3,$4,$5)`, id, p.Epoch, p.Version+int64(i)+1, u.ClientID, []byte(u.Changes)); err != nil {
			return out, err
		}
	}
	out = interviews.Updates{Epoch: p.Epoch, Version: p.Version + int64(len(p.Updates)), Updates: p.Updates}
	if _, err = tx.Exec(ctx, `UPDATE interviews SET source=$2,document_version=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id, source, out.Version); err != nil {
		return out, err
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, out); err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
