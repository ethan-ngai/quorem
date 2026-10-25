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
	suppressEvent                  bool
	id, host, state, problem, mode string
	version                        int64
	settings                       matches.Settings
	expires                        time.Time
	started, deadline, finalizing  *time.Time
	outcome                        []byte
}

func lockMatch(ctx context.Context, tx pgx.Tx, id string) (matchRecord, error) {
	var m matchRecord
	err := tx.QueryRow(ctx, `SELECT id,host_owner_id,state,mode,version,difficulty,duration_minutes,difficulties,COALESCE(selected_problem_version_id::text,''),rules,access_mode,admission_locked,expires_at,COALESCE(problem_version_id::text,''),started_at,deadline,finalizing_at,outcome FROM matches WHERE id::text=$1 FOR UPDATE`, id).Scan(&m.id, &m.host, &m.state, &m.mode, &m.version, &m.settings.Difficulty, &m.settings.DurationMinutes, &m.settings.Difficulties, &m.settings.SelectedProblemVersionID, &m.settings.Rules, &m.settings.AccessMode, &m.settings.AdmissionLocked, &m.expires, &m.problem, &m.started, &m.deadline, &m.finalizing, &m.outcome)
	if errors.Is(err, pgx.ErrNoRows) {
		err = failure("not_found", 404, "Match not found")
	}
	m.settings.Mode = m.mode
	return m, err
}
func (s *Store) matchSnapshot(ctx context.Context, tx pgx.Tx, owner string, m matchRecord) (matches.Snapshot, error) {
	v := matches.Snapshot{ID: m.id, Version: strconv.FormatInt(m.version, 10), State: m.state, Settings: m.settings, ExpiresAt: m.expires, StartedAt: m.started, Deadline: m.deadline, FinalizingAt: m.finalizing, ProblemVersionID: m.problem, Participants: []matches.Participant{}, RuleEvents: []matches.RuleEvent{}}
	if err := tx.QueryRow(ctx, "SELECT participant_id,clock_timestamp() FROM users WHERE id=$1", m.host).Scan(&v.HostUserID, &v.ServerNow); err != nil {
		return v, err
	}
	rows, err := tx.Query(ctx, `SELECT p.owner_id,u.participant_id,u.display_name,p.ready,p.presence,COALESCE(p.workspace_id::text,''),p.best_passed,COALESCE(p.submission_state,''),p.forfeited,u.kind='guest' FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=$1 ORDER BY p.seat`, m.id)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	member := false
	for rows.Next() {
		var p matches.Participant
		var seatOwner string
		var passed int
		if err = rows.Scan(&seatOwner, &p.UserID, &p.DisplayName, &p.Ready, &p.Presence, &p.WorkspaceID, &passed, &p.SubmissionState, &p.Forfeited, &p.Guest); err != nil {
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
	rows.Close()
	events, e := tx.Query(ctx, `SELECT e.id,u.participant_id,e.kind,e.occurred_at FROM match_rule_events e JOIN users u ON u.id=e.owner_id WHERE e.match_id=$1 ORDER BY e.occurred_at,e.id`, m.id)
	if e != nil {
		return v, e
	}
	for events.Next() {
		var event matches.RuleEvent
		event.Action = "announce"
		if e = events.Scan(&event.ID, &event.UserID, &event.Kind, &event.OccurredAt); e != nil {
			events.Close()
			return v, e
		}
		v.RuleEvents = append(v.RuleEvents, event)
	}
	e = events.Err()
	events.Close()
	if e != nil {
		return v, e
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
	if _, err := tx.Exec(ctx, "UPDATE guest_sessions SET expires_at=LEAST(expires_at,clock_timestamp()+interval '2 hours') WHERE match_id=$1", m.id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "DELETE FROM match_reservations WHERE match_id=$1", m.id)
	return err
}

// ActiveMatch uses the authoritative reservation, then reconciles expiry/outcomes.
func (s *Store) ActiveMatch(ctx context.Context, owner string) (*matches.Snapshot, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT r.match_id FROM match_reservations r JOIN match_participants p ON p.match_id=r.match_id AND p.owner_id=r.owner_id WHERE r.owner_id=$1 AND NOT p.forfeited`, owner).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, err := s.Match(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if v.State == "completed" || v.State == "cancelled" {
		return nil, nil
	}
	return &v, nil
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
	if settings, ok := body.(matches.Settings); ok && settings.AccessMode == "accounts_only" && !settings.AdmissionLocked {
		data, _ = json.Marshal(struct {
			Mode                     string        `json:"mode"`
			Difficulties             []string      `json:"difficulties"`
			SelectedProblemVersionID string        `json:"selectedProblemVersionId,omitempty"`
			Rules                    matches.Rules `json:"rules"`
			Difficulty               string        `json:"difficulty"`
			DurationMinutes          int           `json:"durationMinutes"`
		}{settings.Mode, settings.Difficulties, settings.SelectedProblemVersionID, settings.Rules, settings.Difficulty, settings.DurationMinutes})
	}
	fingerprint := Hash(data)
	var hash string
	var prior []byte
	err = tx.QueryRow(ctx, "SELECT body_hash,response FROM match_idempotency WHERE owner_id=$1 AND route=$2 AND key=$3 AND expires_at>clock_timestamp()", owner, route, key).Scan(&hash, &prior)
	if err == nil {
		legacyMatches := false
		if settings, ok := body.(matches.Settings); ok && settings.AccessMode == "accounts_only" && !settings.AdmissionLocked && settings.Mode == matches.Showdown && len(settings.Difficulties) == 1 && settings.SelectedProblemVersionID == "" && settings.Rules.Clipboard == "off" && settings.Rules.Focus == "off" {
			old, _ := json.Marshal(struct {
				Difficulty      string `json:"difficulty"`
				DurationMinutes int    `json:"durationMinutes"`
			}{settings.Difficulty, settings.DurationMinutes})
			legacyMatches = hash == Hash(old)
		}
		if hash != fingerprint && !legacyMatches {
			return failure("idempotency_conflict", 409, "Key was used for a different command")
		}
		if route == "create" || route == "rotate" {
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
	if route == "create" || route == "rotate" {
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
	settings = settings.Normalize()
	if !settings.Valid() {
		return result, failure("invalid_input", 400, "Invalid match settings")
	}
	err := s.matchCommand(ctx, owner, "create", key, settings, func(tx pgx.Tx) (any, error) {
		if err := validateMatchProblem(ctx, tx, settings); err != nil {
			return nil, err
		}
		if err := requireGuestHosting(ctx, tx, owner, settings.AccessMode); err != nil {
			return nil, err
		}
		if err := reserveOwner(ctx, tx, owner); err != nil {
			return nil, err
		}
		token := make([]byte, 32)
		if _, err := rand.Read(token); err != nil {
			return nil, err
		}
		encoded := base64.RawURLEncoding.EncodeToString(token)
		m := matchRecord{id: ID(), state: "waiting", mode: settings.Mode}
		if _, err := tx.Exec(ctx, "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,difficulty,duration_minutes,state,mode,difficulties,selected_problem_version_id,rules,access_mode,admission_locked) VALUES($1,$2,$3,clock_timestamp()+interval '24 hours',$4,$5,'waiting',$6,$7,NULLIF($8,'')::uuid,$9,$10,$11)", m.id, owner, Hash([]byte(encoded)), settings.Difficulty, settings.DurationMinutes, m.mode, settings.Difficulties, settings.SelectedProblemVersionID, settings.Rules, settings.AccessMode, settings.AdmissionLocked); err != nil {
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
		return matches.Created{ID: m.id, State: m.state, InviteURL: "/invite/" + encoded}, nil
	}, &result)
	return result, err
}
func (s *Store) PreviewInvite(ctx context.Context, token string) (matches.InvitePreview, error) {
	var preview matches.InvitePreview
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 {
		return preview, failure("not_found", 404, "Invitation unavailable")
	}
	err = s.Pool.QueryRow(ctx, `SELECT id,admission_locked,access_mode,mode,difficulties,duration_minutes,rules,(SELECT count(*) FROM match_participants p WHERE p.match_id=m.id) FROM matches m WHERE invite_hash=$1 AND expires_at>clock_timestamp() AND state IN ('waiting','ready')`, Hash([]byte(token))).Scan(&preview.ID, &preview.AdmissionLocked, &preview.AccessMode, &preview.Mode, &preview.Difficulties, &preview.DurationMinutes, &preview.Rules, &preview.ParticipantCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return preview, failure("not_found", 404, "Invitation unavailable")
	}
	preview.Capacity = 2
	if preview.Mode == matches.FreeForAll {
		preview.Capacity = 8
	}
	return preview, err
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
		if m.settings.AdmissionLocked {
			return nil, failure("invalid_transition", 409, "Lobby admission is locked")
		}
		if m.host == owner {
			return nil, failure("invalid_transition", 409, "Host cannot claim guest seat")
		}
		var seat int
		if err = tx.QueryRow(ctx, "SELECT CASE WHEN (SELECT count(*) FROM match_participants WHERE match_id=$1)>=$2 THEN 0 ELSE COALESCE(min(n),0) END FROM generate_series(1,8) n WHERE NOT EXISTS(SELECT 1 FROM match_participants WHERE match_id=$1 AND seat=n)", id, m.settings.Capacity()).Scan(&seat); err != nil {
			return nil, err
		}
		if seat == 0 {
			return nil, failure("invalid_transition", 409, "Match is full")
		}
		if err = reserveOwner(ctx, tx, owner); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,$3)", id, owner, seat); err != nil {
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
		if !alreadyClosed && !m.suppressEvent {
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
			var leaving string
			if err = tx.QueryRow(ctx, "SELECT participant_id FROM users WHERE id=$1", owner).Scan(&leaving); err != nil {
				return nil, err
			}
			people := v.Participants[:0]
			for _, p := range v.Participants {
				if p.UserID == leaving {
					continue
				}
				people = append(people, p)
			}
			v.Participants = people
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
		if m.mode == matches.Showdown && total == 2 && readies == 2 {
			return s.startMatch(ctx, tx, m)
		}
		_, err := tx.Exec(ctx, "UPDATE matches SET state=$2 WHERE id=$1", id, m.state)
		return err
	})
}
func (s *Store) UpdateMatchSettings(ctx context.Context, owner, id, key string, settings matches.Settings) (matches.Snapshot, error) {
	settings = settings.Normalize()
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
		var count int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM match_participants WHERE match_id=$1", id).Scan(&count); err != nil {
			return err
		}
		if count > settings.Capacity() {
			return failure("invalid_transition", 409, "Too many players for this mode")
		}
		if err := validateMatchProblem(ctx, tx, settings); err != nil {
			return err
		}
		if err := requireGuestHosting(ctx, tx, owner, settings.AccessMode); err != nil {
			return err
		}
		if settings.AccessMode == "accounts_only" {
			var guests bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=$1 AND u.kind='guest')", id).Scan(&guests); err != nil {
				return err
			}
			if guests {
				return failure("invalid_transition", 409, "Remove guests before disabling guest access")
			}
		}
		previous := m.settings
		previous.AdmissionLocked = settings.AdmissionLocked
		before, _ := json.Marshal(previous)
		after, _ := json.Marshal(settings)
		if string(before) == string(after) {
			m.settings = settings
			_, err := tx.Exec(ctx, "UPDATE matches SET admission_locked=$2 WHERE id=$1", id, settings.AdmissionLocked)
			return err
		}
		m.settings = settings
		m.mode = settings.Mode
		m.state = "waiting"
		if _, err := tx.Exec(ctx, "UPDATE matches SET difficulty=$2,duration_minutes=$3,mode=$4,difficulties=$5,selected_problem_version_id=NULLIF($6,'')::uuid,rules=$7,access_mode=$8,admission_locked=$9,state='waiting' WHERE id=$1", id, settings.Difficulty, settings.DurationMinutes, settings.Mode, settings.Difficulties, settings.SelectedProblemVersionID, settings.Rules, settings.AccessMode, settings.AdmissionLocked); err != nil {
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
		if m.started == nil {
			return finishMatch(ctx, tx, m, "cancelled", "", "forfeit_without_opponent")
		}
		if _, err := tx.Exec(ctx, "UPDATE match_participants SET forfeited=true WHERE match_id=$1 AND owner_id=$2", id, owner); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM match_reservations WHERE match_id=$1 AND owner_id=$2", id, owner); err != nil {
			return err
		}
		var count int
		var winner string
		if err := tx.QueryRow(ctx, "SELECT count(*),COALESCE(min(owner_id),'') FROM match_participants WHERE match_id=$1 AND NOT forfeited", id).Scan(&count, &winner); err != nil {
			return err
		}
		if count == 1 {
			return finishMatch(ctx, tx, m, "win", winner, "forfeit")
		}
		if count == 0 {
			return finishMatch(ctx, tx, m, "cancelled", "", "forfeit_without_opponent")
		}
		return s.reconcileMatch(ctx, tx, m)
	})
}

func (s *Store) startMatch(ctx context.Context, tx pgx.Tx, m *matchRecord) error {
	if err := requireGuestHosting(ctx, tx, m.host, m.settings.AccessMode); err != nil {
		return err
	}
	id := m.id
	rows, err := tx.Query(ctx, "SELECT public FROM problem_versions WHERE problem_id IN (SELECT id FROM problems WHERE owner_id IS NULL) AND (($2<>'' AND id::text=$2) OR ($2='' AND id IN (SELECT DISTINCT ON (slug) id FROM problem_versions ORDER BY slug,version DESC) AND public->>'difficulty'=ANY($1))) ORDER BY id", m.settings.Difficulties, m.settings.SelectedProblemVersionID)
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
func (s *Store) StartMatch(ctx context.Context, owner, id, key string) (matches.Snapshot, error) {
	return s.mutateMatch(ctx, owner, id, key, "start", struct{}{}, func(tx pgx.Tx, m *matchRecord) error {
		if m.host != owner {
			return failure("forbidden", 403, "Only the host can start")
		}
		if m.mode != matches.FreeForAll || (m.state != "waiting" && m.state != "ready") {
			return failure("invalid_transition", 409, "Match cannot start")
		}
		var total, ready int
		if err := tx.QueryRow(ctx, "SELECT count(*),count(*) FILTER(WHERE ready) FROM match_participants WHERE match_id=$1", id).Scan(&total, &ready); err != nil {
			return err
		}
		if total < 2 || total != ready {
			return failure("invalid_transition", 409, "All players must be ready")
		}
		return s.startMatch(ctx, tx, m)
	})
}
