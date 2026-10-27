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
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// StartRealtime attaches the local adapter; authority remains in PostgreSQL.
func (s *Server) StartRealtime(ctx context.Context) error {
	if _, ok := s.Store.(interface {
		MatchEventNotifications(context.Context) (<-chan struct{}, func(), error)
		DispatchInterviewEvents(context.Context, func(realtime.Notice) error) error
		InterviewEventNotifications(context.Context) (<-chan struct{}, func(), error)
		DispatchSubmissionEvents(context.Context, func(realtime.Notice) error) error
		SubmissionEventNotifications(context.Context) (<-chan struct{}, func(), error)
		membershipEventsRepository
	}); !ok {
		return errors.New("realtime outbox notifications are required")
	}
	local := realtime.NewMemory()
	if s.Events == nil {
		s.Events = local
	}
	if s.Presence == nil {
		s.Presence = local
	}
	go func() { <-ctx.Done(); local.Close() }()
	s.startInterviewRealtime(ctx)
	var notifications func(context.Context) (<-chan struct{}, func(), error)
	if repo, ok := s.Store.(interface {
		MatchEventNotifications(context.Context) (<-chan struct{}, func(), error)
	}); ok {
		notifications = repo.MatchEventNotifications
	}
	s.startOutboxDispatcher(ctx, "/matches/", s.Store.DispatchMatchEvents, notifications)
	if repo, ok := s.Store.(interface {
		DispatchSubmissionEvents(context.Context, func(realtime.Notice) error) error
		SubmissionEventNotifications(context.Context) (<-chan struct{}, func(), error)
	}); ok {
		s.startOutboxDispatcher(ctx, "/submissions/", repo.DispatchSubmissionEvents, repo.SubmissionEventNotifications)
	}
	return nil
}

// Commit signals trigger dispatch; failures retry with bounded backoff.
func (s *Server) startOutboxDispatcher(ctx context.Context, topic string, publish func(context.Context, func(realtime.Notice) error) error, notifications func(context.Context) (<-chan struct{}, func(), error)) {
	go s.runOutboxDispatcher(ctx, topic, publish, notifications, time.Second, 30*time.Second)
}

func (s *Server) runOutboxDispatcher(ctx context.Context, topic string, publish func(context.Context, func(realtime.Notice) error) error, notifications func(context.Context) (<-chan struct{}, func(), error), retryMin, retryMax time.Duration) {
	if notifications == nil {
		log.Print("Database notifications unavailable; realtime dispatch disabled")
		return
	}
	var wake <-chan struct{}
	var stop func()
	var retry *time.Timer
	var retryC <-chan time.Time
	delay := retryMin
	defer func() {
		if stop != nil {
			stop()
		}
		if retry != nil {
			retry.Stop()
		}
	}()
	schedule := func() {
		if retry != nil {
			return
		}
		retry = time.NewTimer(delay)
		retryC = retry.C
		delay = min(delay*2, retryMax)
	}
	dispatch := func() error {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return publish(attempt, func(n realtime.Notice) error {
			if err := s.Events.Publish(attempt, topic+n.AggregateID, n); err != nil {
				return err
			}
			if topic == "/matches/" {
				return s.Events.Publish(attempt, "/match-invites/"+n.AggregateID, n)
			}
			return nil
		})
	}
	connect := func() error {
		var err error
		wake, stop, err = notifications(ctx)
		if err != nil || wake == nil {
			if stop != nil {
				stop()
				stop = nil
			}
			wake = nil
			if err != nil {
				return err
			}
			return errors.New("notification listener unavailable")
		}
		return nil
	}
	attempt := func() {
		if wake == nil {
			if err := connect(); err != nil {
				if ctx.Err() == nil {
					log.Print("Database notifications unavailable")
				}
				schedule()
				return
			}
		}
		if err := dispatch(); err != nil {
			if ctx.Err() == nil {
				log.Print("Realtime event dispatch unavailable")
			}
			schedule()
			return
		}
		delay = retryMin
	}
	attempt()
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
				schedule()
			} else {
				if retry == nil {
					attempt()
				}
			}
		case <-retryC:
			retry = nil
			retryC = nil
			attempt()
		}
	}
}

func (s *Server) registerRealtime(mux *http.ServeMux) {
	if s.Events == nil {
		local := realtime.NewMemory()
		s.Events = local
		if s.Presence == nil {
			s.Presence = local
		}
	}
	if s.Presence == nil {
		s.Presence = realtime.NewMemory()
	}
	mux.HandleFunc("GET /v1/matches/{id}/events", s.matchEvents)
	mux.HandleFunc("GET /v1/submissions/{id}/events", s.submissionEvents)
}

func (s *Server) withPresence(snapshot matches.Snapshot) matches.Snapshot {
	if s.Presence == nil {
		return snapshot
	}
	for i := range snapshot.Participants {
		snapshot.Participants[i].Presence = "offline"
		if s.Presence.Online("/matches/"+snapshot.ID, snapshot.Participants[i].UserID) {
			snapshot.Participants[i].Presence = "online"
		}
	}
	return snapshot
}

func developmentSubject(user string) string {
	if user == "alice" {
		return "00000000-0000-4000-8000-000000000001"
	}
	if user == "bob" {
		return "00000000-0000-4000-8000-000000000002"
	}
	if user == "charlie" {
		return "00000000-0000-4000-8000-000000000003"
	}
	if user == "dana" {
		return "00000000-0000-4000-8000-000000000004"
	}
	return ""
}

func (s *Server) matchEvents(w http.ResponseWriter, r *http.Request) {
	user := owner(r)
	origin := r.Header.Get("Origin")
	if origin == "" {
		s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Browser origin required", Status: 401})
		return
	}
	if !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Message: "Origin denied", Status: 403})
		return
	}
	// Local fixture selection is never accepted by the managed verifier.
	if s.Local && !identity.Subject(r.Context()).Guest {
		if selected := r.URL.Query().Get("user"); selected != "" {
			if developmentSubject(selected) == "" {
				s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Unknown development identity", Status: 401})
				return
			}
			user = selected
		}
	}
	id := r.PathValue("id")
	if !uuid.MatchString(id) {
		s.err(w, r, &application.Error{Code: "not_found", Message: "Match not found", Status: 404})
		return
	}
	if _, err := s.Store.Match(r.Context(), user, id); err != nil {
		s.err(w, r, err)
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{origin}, Subprotocols: []string{"quorem"}})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(512)
	ctx := connection.CloseRead(r.Context()) // Authoritative clients cannot publish application messages.
	topic := "/matches/" + id
	notices, unsubscribe, err := s.Events.Subscribe(ctx, topic)
	if err != nil {
		return
	}
	defer unsubscribe()
	disconnect, err := s.connectPresence(ctx, topic, presenceSubject(user), func() { connection.Close(websocket.StatusTryAgainLater, "Connection lease expired") })
	if err != nil {
		connection.Close(websocket.StatusTryAgainLater, "Connection capacity reached")
		return
	}
	defer disconnect()
	bearer, _ := requestBearer(r)
	send := func(notice realtime.Notice) error {
		if cookie, e := r.Cookie(guestCookie); bearer == "" && e == nil {
			p, e := s.Store.GuestIdentity(ctx, cookie.Value)
			if e != nil || p.UserID != user {
				connection.Close(websocket.StatusPolicyViolation, "Guest session expired")
				return identity.ErrUnauthorized
			}
		}
		if bearer != "" {
			p, e := s.Identity.Verify(ctx, bearer)
			if e != nil || p.UserID != user {
				connection.Close(websocket.StatusPolicyViolation, "Sign in required")
				return identity.ErrUnauthorized
			}
		}

		snapshot, e := s.Store.Match(ctx, user, id)
		if e != nil {
			return e
		}
		snapshot = s.withPresence(snapshot)
		eventType := "match.updated"
		if snapshot.State == "completed" || snapshot.State == "cancelled" {
			eventType = "match.completed"
		}
		if notice.ID == "" {
			notice.ID = application.ID()
			notice.OccurredAt = snapshot.ServerNow
		}
		envelope := map[string]any{"eventId": notice.ID, "schemaVersion": 1, "aggregateId": id, "aggregateVersion": snapshot.Version, "type": eventType, "occurredAt": notice.OccurredAt, "payload": snapshot}
		data, e := json.Marshal(envelope)
		if e != nil {
			return e
		}
		write, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return connection.Write(write, websocket.MessageText, data)
	}
	if err = send(realtime.Notice{}); err != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case n, ok := <-notices:
			if !ok {
				return
			}
			if err = send(n); err != nil {
				connection.Close(websocket.StatusPolicyViolation, "Subscription unavailable")
				return
			}
		case <-heartbeat.C:
			ping, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = connection.Ping(ping)
			cancel()
			if err != nil {
				return
			}
			// Periodic authorization catches seat removal even if a publisher was interrupted.
			if err = send(realtime.Notice{}); err != nil {
				return
			}
		}
	}
}

func presenceSubject(user string) string {
	if id := developmentSubject(user); id != "" {
		return id
	}
	return user
}
