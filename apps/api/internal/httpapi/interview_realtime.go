package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
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
	c.SetReadLimit(256 << 10)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	topic := "/interviews/" + id
	notices, stop, err := s.Events.Subscribe(ctx, topic)
	if err != nil {
		return
	}
	defer stop()
	disconnect, err := s.Presence.Connect(topic, user)
	if err != nil {
		c.Close(websocket.StatusTryAgainLater, "Connection capacity reached")
		return
	}
	defer disconnect()
	commands := make(chan interviewCommand, 1)
	go func() {
		defer cancel()
		for {
			_, body, e := c.Read(ctx)
			if e != nil {
				return
			}
			var command interviewCommand
			if json.Unmarshal(body, &command) != nil || len(command.ID) == 0 || len(command.ID) > 128 {
				c.Close(websocket.StatusPolicyViolation, "Invalid command")
				return
			}
			select {
			case commands <- command:
			case <-ctx.Done():
				return
			}
		}
	}()
	write := func(value any) error {
		data, e := json.Marshal(value)
		if e != nil {
			return e
		}
		attempt, done := context.WithTimeout(ctx, 5*time.Second)
		defer done()
		return c.Write(attempt, websocket.MessageText, data)
	}
	bearer, _ := requestBearer(r)
	credentials := func() error {
		if bearer != "" {
			p, e := s.Identity.Verify(ctx, bearer)
			if e != nil || p.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		if identity.Subject(r.Context()).Guest {
			cookie, e := r.Cookie(interviewGuestCookie)
			if e != nil {
				return identity.ErrUnauthorized
			}
			p, e := repo.InterviewGuestIdentity(ctx, cookie.Value)
			if e != nil || p.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		return nil
	}
	authorize := func() error {
		if err := credentials(); err != nil {
			return err
		}
		_, err := repo.Interview(ctx, user, id)
		return err
	}
	if err = write(map[string]any{"type": "changed"}); err != nil {
		return
	}
	credits, lastCommand := 120.0, time.Now()
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case notice, open := <-notices:
			if !open {
				return
			}
			if authorize() != nil {
				c.Close(websocket.StatusPolicyViolation, "Interview access changed")
				return
			}
			if write(map[string]any{"type": "changed", "kind": notice.Type}) != nil {
				return
			}
		case command := <-commands:
			now := time.Now()
			credits += now.Sub(lastCommand).Seconds() * 60
			lastCommand = now
			if credits > 120 {
				credits = 120
			}
			if credits < 1 {
				c.Close(websocket.StatusPolicyViolation, "Command rate exceeded")
				return
			}
			credits--
			// Repository commands authorize membership and role inside their own transaction.
			if credentials() != nil {
				c.Close(websocket.StatusPolicyViolation, "Interview access changed")
				return
			}
			var value any
			var e error
			attempt, done := context.WithTimeout(ctx, 5*time.Second)
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
				return
			}
		case <-heartbeat.C:
			if authorize() != nil {
				c.Close(websocket.StatusPolicyViolation, "Interview access changed")
				return
			}
			ping, done := context.WithTimeout(ctx, 5*time.Second)
			err = c.Ping(ping)
			done()
			if err != nil {
				return
			}
			// Also repairs notices lost by a managed fanout connection without HTTP polling.
			if write(map[string]any{"type": "changed"}) != nil {
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
		tick := time.NewTicker(5 * time.Second)
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
