package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// StartRealtime attaches the local adapter; authority remains in PostgreSQL.
func (s *Server) StartRealtime(ctx context.Context) {
	s.Events = realtime.NewMemory()
	go func() { <-ctx.Done(); s.Events.Close() }()
	go func() {
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := s.Store.DispatchMatchEvents(attempt, func(n realtime.Notice) error { return s.Events.Publish(attempt, "/matches/"+n.AggregateID, n) })
				cancel()
				if err != nil && ctx.Err() == nil {
					log.Print("Match event dispatch unavailable")
				}
			}
		}
	}()
}

func (s *Server) registerRealtime(mux *http.ServeMux) {
	if s.Events == nil {
		s.Events = realtime.NewMemory()
	}
	mux.HandleFunc("GET /v1/matches/{id}/events", s.matchEvents)
}

func (s *Server) withPresence(snapshot matches.Snapshot) matches.Snapshot {
	if s.Events == nil {
		return snapshot
	}
	for i := range snapshot.Participants {
		snapshot.Participants[i].Presence = "offline"
		if s.Events.Online("/matches/"+snapshot.ID, snapshot.Participants[i].UserID) {
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
	return ""
}

func (s *Server) matchEvents(w http.ResponseWriter, r *http.Request) {
	user := r.URL.Query().Get("user")
	if user == "" {
		user = owner(r)
	}
	origin := r.Header.Get("Origin")
	if !s.Local || developmentSubject(user) == "" || (origin != "http://localhost:5173" && origin != "http://127.0.0.1:5173") {
		s.err(w, r, &postgres.Error{Code: "unauthenticated", Message: "Local subscription unavailable", Status: 401})
		return
	}
	id := r.PathValue("id")
	if !uuid.MatchString(id) {
		s.err(w, r, &postgres.Error{Code: "not_found", Message: "Match not found", Status: 404})
		return
	}
	if _, err := s.Store.Match(r.Context(), user, id); err != nil {
		s.err(w, r, err)
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"http://localhost:5173", "http://127.0.0.1:5173"}})
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
	disconnect := s.Events.Connect(topic, developmentSubject(user))
	defer disconnect()
	send := func(notice realtime.Notice) error {
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
			notice.ID = postgres.ID()
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
