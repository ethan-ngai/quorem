package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

func (s *Store) InterviewDocument(ctx context.Context, user, id string) (interviews.Document, error) {
	var document interviews.Document
	var disabled bool
	err := s.Pool.QueryRow(ctx, `SELECT i.source,i.document_version,i.document_epoch,h.disabled`+interviewDocumentAccessSQL, uuidLookup(id), user).Scan(&document.Source, &document.Version, &document.Epoch, &disabled)
	if err == pgx.ErrNoRows {
		return interviews.Document{}, failure("not_found", 404, "Interview unavailable")
	}
	if err != nil {
		return interviews.Document{}, err
	}
	if disabled {
		return interviews.Document{}, failure("forbidden", 403, "Interview unavailable")
	}
	return document, nil
}
func (s *Store) InterviewUpdates(ctx context.Context, user, id, epoch string, version int64) (interviews.Updates, error) {
	var out interviews.Updates
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	v, err := interviewDocumentState(ctx, tx, user, id, false, false)
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
	v, err := interviewDocumentState(ctx, tx, user, id, true, true)
	if err != nil {
		return out, err
	}
	hash := interviewFingerprint(id+":updates", p)
	prior, _, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return out, err
	}
	if prior != "" {
		return interviews.Updates{Epoch: p.Epoch, Version: p.Version + int64(len(p.Updates)), Updates: p.Updates}, nil
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
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, nil); err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// Hot document/presence paths need access and version state, never the private question fixture.
func interviewDocumentState(ctx context.Context, tx pgx.Tx, user, id string, active, lock bool) (interviewRecord, error) {
	var v interviewRecord
	var enabled bool
	lockClause := ""
	if lock {
		lockClause = " FOR NO KEY UPDATE OF i"
	}
	err := tx.QueryRow(ctx, interviewDocumentStateQuery+lockClause, uuidLookup(id), user, active).Scan(&v.snapshot.State, &v.snapshot.Document.Source, &v.snapshot.Document.Version, &v.snapshot.Document.Epoch, &enabled)
	if err == pgx.ErrNoRows {
		return v, failure("not_found", 404, "Interview unavailable")
	}
	if err != nil {
		return v, err
	}
	if active && v.snapshot.State != "active" {
		return v, failure("invalid_transition", 409, "Interview is closed")
	}
	if active && !enabled {
		return v, failure("entitlement_required", 403, "Interview access is disabled")
	}
	return v, nil
}

const interviewDocumentStateQuery = `SELECT i.state,CASE WHEN $3 THEN i.source ELSE '' END,i.document_version,i.document_epoch,
	EXISTS(SELECT 1 FROM entitlement_grants g WHERE g.user_id=i.host_id AND g.feature IN ('internal','interviews.host') AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()))
` + interviewDocumentAccessSQL + ` AND NOT h.disabled`

const interviewDocumentAccessSQL = ` FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=$2 AND m.removed_at IS NULL
	JOIN users u ON u.id=m.user_id AND NOT u.disabled JOIN users h ON h.id=i.host_id
	WHERE i.id=$1 AND i.deleted_at IS NULL`
