package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

type interviewCommand struct {
	Kind         string                   `json:"kind"`
	ID           string                   `json:"id"`
	Type         string                   `json:"type"`
	Key          string                   `json:"key"`
	Epoch        string                   `json:"epoch"`
	Version      int64                    `json:"version"`
	Push         interviews.Push          `json:"push"`
	SubmissionID string                   `json:"submissionId"`
	Presence     interviews.PresenceInput `json:"presence"`
}

// interviewEvents keeps private payloads on authorized API sockets; providers carry notices only.
func (s *Server) interviewEvents(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	origin := r.Header.Get("Origin")
	if origin == "" || !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Origin denied"})
		return
	}
	user, id := owner(r), r.PathValue("id")
	if _, err := repo.Interview(r.Context(), user, id); err != nil {
		s.err(w, r, err)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{origin}, Subprotocols: []string{"quorem"}})
	if err != nil {
		return
	}
	defer c.CloseNow()
	var closeCode atomic.Int64
	closeCode.Store(int64(websocket.StatusNormalClosure))
	var closeReason atomic.Value
	closeReason.Store("handler ended")
	closeSocket := func(code websocket.StatusCode, reason string) {
		closeCode.Store(int64(code))
		closeReason.Store(reason)
		c.Close(code, reason)
	}
	defer func() { log.Printf("Interview socket closed code=%d reason=%s", closeCode.Load(), closeReason.Load()) }()
	c.SetReadLimit(256 << 10)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	topic := "/interviews/" + id
	notices, stop, err := s.Events.Subscribe(ctx, topic)
	if err != nil {
		return
	}
	defer stop()
	disconnect, err := s.connectPresence(ctx, topic, user, func() { closeSocket(websocket.StatusTryAgainLater, "Connection lease expired") })
	if err != nil {
		closeSocket(websocket.StatusTryAgainLater, "Connection capacity reached")
		return
	}
	defer disconnect()
	write := func(value any) error {
		data, e := json.Marshal(value)
		if e != nil {
			return e
		}
		attempt, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		if err := c.Write(attempt, websocket.MessageText, data); err != nil {
			closeCode.Store(int64(websocket.CloseStatus(err)))
			closeReason.Store("write failed")
			return err
		}
		return nil
	}
	bearer, _ := requestBearer(r)
	verifyCredentials := func(attempt context.Context) error {
		if bearer != "" {
			if s.Identity == nil {
				return identity.ErrUnauthorized
			}
			p, e := s.Identity.Verify(attempt, bearer)
			if e != nil {
				return e
			}
			if p.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		if identity.Subject(r.Context()).Guest {
			cookie, e := r.Cookie(interviewGuestCookie)
			if e != nil {
				return identity.ErrUnauthorized
			}
			p, e := repo.InterviewGuestIdentity(attempt, cookie.Value)
			if e != nil {
				return e
			}
			if p.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		return nil
	}
	var credentialMu sync.Mutex
	var checkedUntil time.Time
	var bearerExpiry time.Time
	if parts := strings.Split(bearer, "."); len(parts) == 3 {
		var claims struct {
			Expiry int64 `json:"exp"`
		}
		if data, e := base64.RawURLEncoding.DecodeString(parts[1]); e == nil && json.Unmarshal(data, &claims) == nil && claims.Expiry > 0 {
			bearerExpiry = time.Unix(claims.Expiry, 0)
		}
	}
	credentials := func(attempt context.Context) error {
		credentialMu.Lock()
		defer credentialMu.Unlock()
		if time.Now().Before(checkedUntil) {
			return nil
		}
		if err := verifyCredentials(attempt); err != nil {
			return err
		}
		// Bound session-service amplification; repository membership checks still run per command.
		checkedUntil = time.Now().Add(2 * time.Second)
		if !bearerExpiry.IsZero() && bearerExpiry.Before(checkedUntil) {
			checkedUntil = bearerExpiry
		}
		return nil
	}
	authorize := func() error {
		attempt, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		if err := credentials(attempt); err != nil {
			return err
		}
		_, err := repo.InterviewPresence(attempt, user, id)
		return err
	}
	denied := func(err error) bool {
		var known *application.Error
		return errors.Is(err, identity.ErrUnauthorized) || (errors.As(err, &known) && (known.Status == 401 || known.Status == 403 || known.Status == 404))
	}
	if err = write(map[string]any{"type": "changed"}); err != nil {
		return
	}
	commands := make(chan interviewCommand, 16)
	advisory := make(chan interviewCommand, 16)
	go func() {
		defer cancel()
		credits, lastCommand := 120.0, time.Now()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				closeCode.Store(int64(websocket.CloseStatus(err)))
				closeReason.Store("read ended")
				return
			}
			var command interviewCommand
			if json.Unmarshal(data, &command) != nil || len(command.ID) == 0 || len(command.ID) > 128 {
				closeSocket(websocket.StatusPolicyViolation, "Invalid command")
				return
			}
			now := time.Now()
			credits = min(120, credits+now.Sub(lastCommand).Seconds()*60)
			lastCommand = now
			if credits < 1 {
				closeSocket(websocket.StatusPolicyViolation, "Command rate exceeded")
				return
			}
			credits--
			lane := advisory
			if command.Type == "push" || command.Type == "pull" || command.Type == "rule-event" {
				lane = commands
			}
			select {
			case lane <- command:
			case <-ctx.Done():
				return
			default:
				if write(map[string]any{"type": "response", "id": command.ID, "error": map[string]any{"code": "temporarily_unavailable", "status": 503, "message": "Interview busy; retry"}}) != nil {
					return
				}
			}
		}
	}()
	execute := func(command interviewCommand) bool {
		started := time.Now()
		defer func() {
			if elapsed := time.Since(started); elapsed >= 250*time.Millisecond {
				kind := command.Type
				switch kind {
				case "pull", "push", "presence", "peers", "submission", "rule-event", "snapshot":
				default:
					kind = "unknown"
				}
				log.Printf("Interview socket slow command=%s duration_ms=%d", kind, elapsed.Milliseconds())
			}
		}()
		// Repository commands authorize membership and role inside their own transaction.
		attempt, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		var value any
		e := credentials(attempt)
		if denied(e) {
			closeSocket(websocket.StatusPolicyViolation, "Interview access changed")
			return false
		}
		if e == nil {
			switch command.Type {
			case "pull":
				value, e = repo.InterviewUpdates(attempt, user, id, command.Epoch, command.Version)
			case "push":
				if len(command.Key) < 8 || len(command.Key) > 128 {
					e = &application.Error{Code: "invalid_input", Status: 400, Message: "Retry key required"}
				} else {
					value, e = repo.PushInterviewUpdates(attempt, user, id, command.Key, command.Push)
				}
			case "presence":
				value, e = repo.UpdateInterviewPresence(attempt, user, id, command.Presence)
			case "peers":
				value, e = repo.InterviewPresence(attempt, user, id)
			case "submission":
				value, e = repo.InterviewSubmission(attempt, user, id, command.SubmissionID)
			case "rule-event":
				e = repo.ReportInterviewRule(attempt, user, id, command.Key, command.Kind)
				value = struct{}{}
			case "snapshot":
				value, e = repo.Interview(attempt, user, id)
			default:
				e = &application.Error{Code: "invalid_input", Status: 400, Message: "Unknown command"}
			}
		}
		done()
		response := map[string]any{"id": command.ID, "type": "response"}
		if e != nil {
			safe := &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Interview unavailable"}
			var known *application.Error
			if errors.As(e, &known) {
				safe = known
			}
			response["error"] = map[string]any{"code": safe.Code, "status": safe.Status, "message": safe.Message}
		} else {
			response["value"] = value
		}
		if write(response) != nil {
			return false
		}

		return true
	}
	for _, lane := range []<-chan interviewCommand{commands, advisory} {
		go func() {
			defer cancel()
			for {
				select {
				case <-ctx.Done():
					return
				case command := <-lane:
					if !execute(command) {
						return
					}
				}
			}
		}()
	}
	// Transport liveness must not wait for command, authorization or fanout database work.
	go func() {
		defer cancel()
		heartbeat := time.NewTicker(10 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeat.C:
				ping, done := context.WithTimeout(ctx, 5*time.Second)
				pingErr := c.Ping(ping)
				done()
				if pingErr != nil {
					closeCode.Store(int64(websocket.CloseStatus(pingErr)))
					closeReason.Store("heartbeat failed")
					return
				}
				if write(map[string]any{"type": "heartbeat"}) != nil {
					return
				}
				if access := authorize(); access != nil {
					if denied(access) {
						closeSocket(websocket.StatusPolicyViolation, "Interview access changed")
						return
					}
					continue
				}
				// Also repairs notices lost by a managed fanout connection without HTTP polling.
				if write(map[string]any{"type": "changed"}) != nil {
					return
				}
			}
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case notice, open := <-notices:
			if !open {
				closeSocket(websocket.StatusTryAgainLater, "Realtime temporarily unavailable")
				return
			}
			if access := authorize(); access != nil {
				if denied(access) {
					closeSocket(websocket.StatusPolicyViolation, "Interview access changed")
					return
				}
				continue
			}
			if write(map[string]any{"type": "changed", "kind": notice.Type}) != nil {
				return
			}
		}
	}
}

// Durable dispatch is commit-driven; a slow recovery tick covers missed LISTEN notifications.
func (s *Server) startInterviewRealtime(ctx context.Context) {
	repo, ok := s.Store.(interface {
		DispatchInterviewEvents(context.Context, func(realtime.Notice) error) error
		InterviewEventNotifications(context.Context) (<-chan struct{}, func(), error)
	})
	if !ok {
		return
	}
	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		var wake <-chan struct{}
		var stop func()
		defer func() {
			if stop != nil {
				stop()
			}
		}()
		dispatch := func() {
			attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := repo.DispatchInterviewEvents(attempt, func(n realtime.Notice) error { return s.Events.Publish(attempt, "/interviews/"+n.AggregateID, n) }); err != nil && ctx.Err() == nil {
				log.Print("Interview event dispatch unavailable")
			}
		}
		connect := func() {
			var err error
			wake, stop, err = repo.InterviewEventNotifications(ctx)
			if err != nil {
				wake = nil
				log.Print("Interview database notifications unavailable; using bounded outbox recovery")
			}
		}
		connect()
		dispatch()
		for {
			select {
			case <-ctx.Done():
				return
			case _, open := <-wake:
				if !open {
					if stop != nil {
						stop()
					}
					wake = nil
				} else {
					dispatch()
				}
			case <-tick.C:
				if wake == nil {
					connect()
				}
				dispatch()
			}
		}
	}()
}
