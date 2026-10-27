package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

type membershipEventsRepository interface {
	MembershipRealtimeID(context.Context, string) (string, error)
	MembershipEventNotifications(context.Context) (<-chan struct{}, func(), error)
	DispatchMembershipEvents(context.Context, func(realtime.Notice) error) error
}

// StartMembershipRealtime relays durable, owner-scoped invalidations across replicas.
func (s *Server) StartMembershipRealtime(ctx context.Context) {
	if repo, ok := s.Store.(membershipEventsRepository); ok {
		s.startOutboxDispatcher(ctx, "/memberships/", repo.DispatchMembershipEvents, repo.MembershipEventNotifications)
	}
}

func (s *Server) currentMatchEvents(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.Store.(membershipEventsRepository)
	if !ok {
		s.err(w, r, &application.Error{Code: "unavailable", Status: 503, Message: "Membership events unavailable"})
		return
	}
	origin := r.Header.Get("Origin")
	if origin == "" || !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Origin denied"})
		return
	}
	user := owner(r)
	if s.Local && !identity.Subject(r.Context()).Guest {
		if selected := r.URL.Query().Get("user"); selected != "" {
			if developmentSubject(selected) == "" {
				s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Unknown development identity"})
				return
			}
			user = selected
		}
	}
	id, err := repo.MembershipRealtimeID(r.Context(), user)
	if err != nil {
		s.err(w, r, err)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{origin}, Subprotocols: []string{"quorem"}})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(512)
	ctx := conn.CloseRead(r.Context())
	notices, stop, err := s.Events.Subscribe(ctx, "/memberships/"+id)
	if err != nil {
		return
	}
	defer stop()
	bearer, _ := requestBearer(r)
	verify := func() error {
		if bearer != "" {
			if s.Identity == nil {
				return identity.ErrUnauthorized
			}
			principal, e := s.Identity.Verify(ctx, bearer)
			if e != nil || principal.UserID != user {
				return identity.ErrUnauthorized
			}
		} else if cookie, e := r.Cookie(guestCookie); e == nil {
			principal, e := s.Store.GuestIdentity(ctx, cookie.Value)
			if e != nil || principal.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		return nil
	}
	send := func(kind string) error {
		if e := verify(); e != nil {
			return e
		}
		data, _ := json.Marshal(map[string]string{"type": kind})
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return conn.Write(attempt, websocket.MessageText, data)
	}
	// The first frame fences the snapshot against subscription races.
	if err = send("membership.updated"); err != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case _, open := <-notices:
			if !open || send("membership.updated") != nil {
				return
			}
		case <-heartbeat.C:
			if verify() != nil {
				conn.Close(websocket.StatusPolicyViolation, "Session expired")
				return
			}
			ping, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Ping(ping)
			cancel()
			if err != nil {
				return
			}
			if send("heartbeat") != nil {
				return
			}
		}
	}
}
