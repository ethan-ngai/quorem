package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

type matchRecord struct {
	id, host, state, problem, mode string
	version                        int64
	settings                       matches.Settings
	expires                        time.Time
	started, deadline, finalizing  *time.Time
	outcome                        []byte
}

func lockMatch(ctx context.Context, tx pgx.Tx, id string) (matchRecord, error) {
	var m matchRecord
	err := tx.QueryRow(ctx, `SELECT id,host_owner_id,state,mode,version,difficulty,duration_minutes,expires_at,COALESCE(problem_version_id::text,''),started_at,deadline,finalizing_at,outcome FROM matches WHERE id::text=$1 FOR UPDATE`, id).Scan(&m.id, &m.host, &m.state, &m.mode, &m.version, &m.settings.Difficulty, &m.settings.DurationMinutes, &m.expires, &m.problem, &m.started, &m.deadline, &m.finalizing, &m.outcome)
	if errors.Is(err, pgx.ErrNoRows) {
		err = failure("not_found", 404, "Match not found")
	}
	return m, err
}
func (s *Store) matchSnapshot(ctx context.Context, tx pgx.Tx, owner string, m matchRecord) (matches.Snapshot, error) {
	v := matches.Snapshot{ID: m.id, Mode: m.mode, Version: strconv.FormatInt(m.version, 10), State: m.state, Settings: m.settings, ExpiresAt: m.expires, StartedAt: m.started, Deadline: m.deadline, FinalizingAt: m.finalizing, ProblemVersionID: m.problem, Participants: []matches.Participant{}}
	if err := tx.QueryRow(ctx, "SELECT participant_id,clock_timestamp() FROM users WHERE id=$1", m.host).Scan(&v.HostUserID, &v.ServerNow); err != nil {
		return v, err
	}
	rows, err := tx.Query(ctx, `SELECT p.owner_id,u.participant_id,u.display_name,p.ready,p.presence,COALESCE(p.workspace_id::text,''),p.best_passed,COALESCE(p.submission_state,'') FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=$1 ORDER BY p.seat`, m.id)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	member := false
	for rows.Next() {
		var p matches.Participant
		var seatOwner string
		var passed int
		if err = rows.Scan(&seatOwner, &p.UserID, &p.DisplayName, &p.Ready, &p.Presence, &p.WorkspaceID, &passed, &p.SubmissionState); err != nil {
			return v, err
		}
		if seatOwner == owner {
			member = true
		} else {
			p.WorkspaceID = ""
		}
		if m.started != nil {
			p.BestScore = &execution.Score{Passed: passed, Total: 20}
		}
		v.Participants = append(v.Participants, p)
	}
	if err = rows.Err(); err != nil {
		return v, err
	}
	if !member {
		return v, failure("not_found", 404, "Match not found")
	}
	if len(m.outcome) > 0 {
		v.Outcome = &matches.Outcome{}
		err = json.Unmarshal(m.outcome, v.Outcome)
	}
	return v, err
}
func matchEvent(ctx context.Context, tx pgx.Tx, m *matchRecord) error {
	typ := "match.updated"
	if m.state == "completed" || m.state == "cancelled" {
		typ = "match.completed"
	}
	if err := tx.QueryRow(ctx, "UPDATE matches SET version=version+1 WHERE id=$1 RETURNING version", m.id).Scan(&m.version); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "INSERT INTO match_outbox(id,match_id,version,event_type) VALUES($1,$2,$3,$4)", ID(), m.id, m.version, typ)
	return err
}
func finishMatch(ctx context.Context, tx pgx.Tx, m *matchRecord, kind, winner, reason string) error {
	var now time.Time
	var winnerID string
	if err := tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return err
	}
	if winner != "" {
		if err := tx.QueryRow(ctx, "SELECT participant_id FROM users WHERE id=$1", winner).Scan(&winnerID); err != nil {
			return err
		}
	}
	m.state = "completed"
	if kind == "cancelled" {
		m.state = "cancelled"
	}
	m.outcome, _ = json.Marshal(matches.Outcome{Kind: kind, WinnerUserID: winnerID, Reason: reason, CompletedAt: now})
	if _, err := tx.Exec(ctx, "UPDATE matches SET state=$2,outcome=$3 WHERE id=$1", m.id, m.state, m.outcome); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "DELETE FROM match_reservations WHERE match_id=$1", m.id)
	return err
}
func (s *Store) Match(ctx context.Context, owner, id string) (matches.Snapshot, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return matches.Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	m, err := lockMatch(ctx, tx, id)
	if err != nil {
		return matches.Snapshot{}, err
	}
	// Membership is checked before reconciliation to avoid an unauthorized state mutation.
	if _, err = s.matchSnapshot(ctx, tx, owner, m); err != nil {
		return matches.Snapshot{}, err
	}
	if err = s.reconcileMatch(ctx, tx, &m); err != nil {
		return matches.Snapshot{}, err
	}
	v, err := s.matchSnapshot(ctx, tx, owner, m)
	if err != nil {
		return v, err
	}
	return v, tx.Commit(ctx)
}
func (s *Store) matchCommand(ctx context.Context, owner, route, key string, body any, run func(pgx.Tx) (any, error), result any) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,740040))", owner+":"+route+":"+key); err != nil {
		return err
	}
	data, _ := json.Marshal(body)
	fingerprint := Hash(data)
	var hash string
	var prior []byte
	err = tx.QueryRow(ctx, "SELECT body_hash,response FROM match_idempotency WHERE owner_id=$1 AND route=$2 AND key=$3 AND expires_at>clock_timestamp()", owner, route, key).Scan(&hash, &prior)
	if err == nil {
		if hash != fingerprint {
			return failure("idempotency_conflict", 409, "Key was used for a different command")
		}
		if route == "create" {
			prior, err = s.decryptInviteResponse(prior)
			if err != nil {
				return err
			}
		}
		return json.Unmarshal(prior, result)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	v, err := run(tx)
	if err != nil {
		return err
	}
	response, err := json.Marshal(v)
	if err != nil {
		return err
	}
	storedResponse := response
	if route == "create" {
		storedResponse, err = s.encryptInviteResponse(response)
		if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,route,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`, owner, route, key, fingerprint, storedResponse); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return json.Unmarshal(response, result)
}
func reserveOwner(ctx context.Context, tx pgx.Tx, owner string) error {
	var user string
	if err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", owner).Scan(&user); err != nil {
		return err
	}
	var busy bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM match_reservations WHERE owner_id=$1)", owner).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return failure("user_busy", 409, "Another match is active")
	}
	return nil
}
func (s *Store) CreateMatch(ctx context.Context, owner, key string, settings matches.Settings) (matches.Created, error) {
	var result matches.Created
	if settings.DurationMinutes == 0 {
		settings.DurationMinutes = 30
	}
	if !settings.Valid() {
		return result, failure("invalid_input", 400, "Invalid match settings")
	}
	err := s.matchCommand(ctx, owner, "create", key, settings, func(tx pgx.Tx) (any, error) {
		if err := reserveOwner(ctx, tx, owner); err != nil {
			return nil, err
		}
		token := make([]byte, 32)
		if _, err := rand.Read(token); err != nil {
			return nil, err
		}
		encoded := base64.RawURLEncoding.EncodeToString(token)
		m := matchRecord{id: ID(), state: "waiting", mode: matches.Showdown}
		if _, err := tx.Exec(ctx, "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,difficulty,duration_minutes,state,mode) VALUES($1,$2,$3,clock_timestamp()+interval '24 hours',$4,$5,'waiting',$6)", m.id, owner, Hash([]byte(encoded)), settings.Difficulty, settings.DurationMinutes, m.mode); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1);", m.id, owner); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", owner, m.id); err != nil {
			return nil, err
		}
		if err := matchEvent(ctx, tx, &m); err != nil {
			return nil, err
		}
		return matches.Created{ID: m.id, State: m.state, InviteURL: "http://localhost:5173/invite/" + encoded}, nil
	}, &result)
	return result, err
}
func (s *Store) JoinMatch(ctx context.Context, owner, key, token string) (matches.Snapshot, error) {
	var result matches.Snapshot
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 {
		return result, failure("not_found", 404, "Invite not found")
	}
	err = s.matchCommand(ctx, owner, "join", key, token, func(tx pgx.Tx) (any, error) {
		// All user admissions lock the owner before the match.
		var user string
		if err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", owner).Scan(&user); err != nil {
			return nil, err
		}
		var id string
		if err := tx.QueryRow(ctx, "SELECT id FROM matches WHERE invite_hash=$1", Hash([]byte(token))).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
			return nil, failure("not_found", 404, "Invite not found")
		} else if err != nil {
			return nil, err
		}
		m, err := lockMatch(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if err = s.reconcileMatch(ctx, tx, &m); err != nil {
			return nil, err
		}
		if m.state != "waiting" && m.state != "ready" {
			return nil, failure("invalid_transition", 409, "Invite is closed")
		}
		if m.host == owner {
			return nil, failure("invalid_transition", 409, "Host cannot claim guest seat")
		}
		var occupied bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM match_participants WHERE match_id=$1 AND seat=2)", id).Scan(&occupied); err != nil {
			return nil, err
		}
		if occupied {
			return nil, failure("invalid_transition", 409, "Match is full")
		}
		if err = reserveOwner(ctx, tx, owner); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,2)", id, owner); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", owner, id); err != nil {
			return nil, err
		}
		if err = matchEvent(ctx, tx, &m); err != nil {
			return nil, err
		}
		return s.matchSnapshot(ctx, tx, owner, m)
	}, &result)
	return result, err
}
func (s *Store) mutateMatch(ctx context.Context, owner, id, key, action string, body any, mutate func(pgx.Tx, *matchRecord) error) (matches.Snapshot, error) {
	var result matches.Snapshot
	err := s.matchCommand(ctx, owner, action+":"+id, key, body, func(tx pgx.Tx) (any, error) {
		m, err := lockMatch(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if _, err = s.matchSnapshot(ctx, tx, owner, m); err != nil {
			return nil, err
		}
		if action != "forfeit" {
			if err = s.reconcileMatch(ctx, tx, &m); err != nil {
				return nil, err
			}
		}
		alreadyClosed := m.outcome != nil
		if err = mutate(tx, &m); err != nil {
			return nil, err
		}
		if !alreadyClosed {
			if err = matchEvent(ctx, tx, &m); err != nil {
				return nil, err
			}
		}
		v, err := s.matchSnapshot(ctx, tx, owner, m)
		if err != nil {
			return nil, err
		}
		if action == "leave" && owner != m.host && m.started == nil && m.outcome == nil {
			if _, err = tx.Exec(ctx, "DELETE FROM match_participants WHERE match_id=$1 AND owner_id=$2", id, owner); err != nil {
				return nil, err
			}
			v.Participants = v.Participants[:1]
		}
		return v, nil
	}, &result)
	return result, err
}
func (s *Store) ReadyMatch(ctx context.Context, owner, id, key string, ready bool) (matches.Snapshot, error) {
	return s.mutateMatch(ctx, owner, id, key, "ready", ready, func(tx pgx.Tx, m *matchRecord) error {
		if m.state != "waiting" && m.state != "ready" {
			return failure("invalid_transition", 409, "Match has started or closed")
		}
		if _, err := tx.Exec(ctx, "UPDATE match_participants SET ready=$3,presence='offline' WHERE match_id=$1 AND owner_id=$2", id, owner, ready); err != nil {
			return err
		}
		var total, readies int
		if err := tx.QueryRow(ctx, "SELECT count(*),count(*) FILTER(WHERE ready) FROM match_participants WHERE match_id=$1", id).Scan(&total, &readies); err != nil {
			return err
		}
		m.state = "waiting"
		if readies > 0 {
			m.state = "ready"
		}
		if total == 2 && readies == 2 {
			rows, err := tx.Query(ctx, "SELECT public FROM (SELECT DISTINCT ON (slug) id,public FROM problem_versions ORDER BY slug,version DESC) latest WHERE public->>'difficulty'=$1 ORDER BY id", m.settings.Difficulty)
			if err != nil {
				return err
			}
			pool := []problems.Problem{}
			for rows.Next() {
				var data []byte
				var p problems.Problem
				if err = rows.Scan(&data); err != nil {
					rows.Close()
					return err
				}
				if err = json.Unmarshal(data, &p); err != nil {
					rows.Close()
					return err
				}
				pool = append(pool, p)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
			if len(pool) == 0 {
				return failure("temporarily_unavailable", 503, "Difficulty pool is empty")
			}
			choice, err := rand.Int(rand.Reader, big.NewInt(int64(len(pool))))
			if err != nil {
				return err
			}
			p := pool[choice.Int64()]
			m.state = "active"
			m.problem = p.ID
			if err = tx.QueryRow(ctx, "UPDATE matches SET state='active',problem_version_id=$2,started_at=clock_timestamp(),deadline=clock_timestamp()+make_interval(mins=>duration_minutes) WHERE id=$1 RETURNING started_at,deadline", id, p.ID).Scan(&m.started, &m.deadline); err != nil {
				return err
			}
			rows, err = tx.Query(ctx, "SELECT owner_id FROM match_participants WHERE match_id=$1 ORDER BY seat", id)
			if err != nil {
				return err
			}
			owners := []string{}
			for rows.Next() {
				var o string
				if err = rows.Scan(&o); err != nil {
					rows.Close()
					return err
				}
				owners = append(owners, o)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
			for _, o := range owners {
				w := ID()
				if _, err = tx.Exec(ctx, "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$2,$3,'python','match',$4)", w, o, p.ID, id); err != nil {
					return err
				}
				if _, err = tx.Exec(ctx, "UPDATE match_participants SET workspace_id=$3 WHERE match_id=$1 AND owner_id=$2", id, o, w); err != nil {
					return err
				}
			}
			return nil
		}
		_, err := tx.Exec(ctx, "UPDATE matches SET state=$2 WHERE id=$1", id, m.state)
		return err
	})
}
func (s *Store) UpdateMatchSettings(ctx context.Context, owner, id, key string, settings matches.Settings) (matches.Snapshot, error) {
	if !settings.Valid() {
		return matches.Snapshot{}, failure("invalid_input", 400, "Invalid match settings")
	}
	return s.mutateMatch(ctx, owner, id, key, "settings", settings, func(tx pgx.Tx, m *matchRecord) error {
		if m.host != owner {
			return failure("forbidden", 403, "Only the host can change settings")
		}
		if m.started != nil || m.outcome != nil {
			return failure("invalid_transition", 409, "Match settings are fixed")
		}
		m.settings = settings
		m.state = "waiting"
		if _, err := tx.Exec(ctx, "UPDATE matches SET difficulty=$2,duration_minutes=$3,state='waiting' WHERE id=$1", id, settings.Difficulty, settings.DurationMinutes); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "UPDATE match_participants SET ready=false WHERE match_id=$1", id)
		return err
	})
}
func (s *Store) LeaveMatch(ctx context.Context, owner, id, key string) (matches.Snapshot, error) {
	return s.mutateMatch(ctx, owner, id, key, "leave", struct{}{}, func(tx pgx.Tx, m *matchRecord) error {
		if m.outcome != nil {
			return nil
		}
		if m.started != nil {
			_, err := tx.Exec(ctx, "UPDATE match_participants SET presence='offline' WHERE match_id=$1 AND owner_id=$2", id, owner)
			return err
		}
		if m.host == owner {
			return finishMatch(ctx, tx, m, "cancelled", "", "host_left")
		}
		// Retain the leaving viewer through response serialization, then remove the seat below.
		_, err := tx.Exec(ctx, "UPDATE match_participants SET ready=false,presence='offline' WHERE match_id=$1", id)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "DELETE FROM match_reservations WHERE owner_id=$1 AND match_id=$2", owner, id)
		if err != nil {
			return err
		}
		m.state = "waiting"
		_, err = tx.Exec(ctx, "UPDATE matches SET state='waiting' WHERE id=$1", id)
		return err
	})
}
func (s *Store) ForfeitMatch(ctx context.Context, owner, id, key string) (matches.Snapshot, error) {
	return s.mutateMatch(ctx, owner, id, key, "forfeit", struct{}{}, func(tx pgx.Tx, m *matchRecord) error {
		if m.outcome != nil {
			return nil
		}
		var winner string
		err := tx.QueryRow(ctx, "SELECT owner_id FROM match_participants WHERE match_id=$1 AND owner_id<>$2", id, owner).Scan(&winner)
		if errors.Is(err, pgx.ErrNoRows) {
			return finishMatch(ctx, tx, m, "cancelled", "", "forfeit_without_opponent")
		}
		if err != nil {
			return err
		}
		return finishMatch(ctx, tx, m, "win", winner, "forfeit")
	})
}
