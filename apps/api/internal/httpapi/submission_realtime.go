package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

// Only owner-authorized snapshots cross the browser connection; the relay carries notices.
func (s *Server) submissionEvents(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" || !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Origin denied"})
		return
	}
	user, id := owner(r), r.PathValue("id")
	if s.Local && !identity.Subject(r.Context()).Guest {
		if selected := r.URL.Query().Get("user"); selected != "" {
			if developmentSubject(selected) == "" {
				s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Unknown development identity"})
				return
			}
			user = selected
		}
	}
	if !uuid.MatchString(id) {
		s.err(w, r, &application.Error{Code: "not_found", Status: 404, Message: "Submission not found"})
		return
	}
	if _, err := s.Store.Submission(r.Context(), user, id); err != nil {
		s.err(w, r, err)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{origin}, Subprotocols: []string{"quorem"}})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(512)
	ctx := c.CloseRead(r.Context())
	notices, stop, err := s.Events.Subscribe(ctx, "/submissions/"+id)
	if err != nil {
		return
	}
	defer stop()
	bearer, _ := requestBearer(r)
	authorize := func() error {
		if bearer != "" {
			if s.Identity == nil {
				return identity.ErrUnauthorized
			}
			p, e := s.Identity.Verify(ctx, bearer)
			if e != nil || p.UserID != user {
				return identity.ErrUnauthorized
			}
		} else if cookie, e := r.Cookie(guestCookie); e == nil {
			p, e := s.Store.GuestIdentity(ctx, cookie.Value)
			if e != nil || p.UserID != user {
				return identity.ErrUnauthorized
			}
		}
		return nil
	}
	send := func() error {
		if err := authorize(); err != nil {
			return err
		}
		snapshot, err := s.Store.Submission(ctx, user, id)
		if err != nil {
			return err
		}
		snapshot.PrivateCaseResults = nil
		data, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return c.Write(attempt, websocket.MessageText, data)
	}
	// Subscribe before the initial read, closing the commit-to-subscribe gap.
	if err = send(); err != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-notices:
			if !ok {
				return
			}
			if err = send(); err != nil {
				return
			}
		case <-heartbeat.C:
			if err = authorize(); err != nil {
				return
			}
			ping, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = c.Ping(ping)
			cancel()
			if err != nil {
				return
			}
			attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = c.Write(attempt, websocket.MessageText, []byte(`{"type":"heartbeat"}`))
			cancel()
			if err != nil {
				return
			}
		}
	}
}
