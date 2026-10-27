package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
)

// Preview notices carry no private room state; the token authorizes each snapshot fetch.
func (s *Server) previewInviteEvents(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" || !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Origin denied"})
		return
	}
	preview, err := s.Store.PreviewInvite(r.Context(), r.PathValue("token"))
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
	notices, stop, err := s.Events.Subscribe(ctx, "/match-invites/"+preview.ID)
	if err != nil {
		return
	}
	defer stop()
	send := func() error {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return conn.Write(attempt, websocket.MessageText, []byte(`{"type":"changed"}`))
	}
	// Subscribe before prompting the client to fetch, closing the snapshot race.
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
			_, authorized := s.Store.PreviewInvite(ctx, r.PathValue("token"))
			if send() != nil || authorized != nil {
				return
			}
		case <-heartbeat.C:
			attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Ping(attempt)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
