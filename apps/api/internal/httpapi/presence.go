package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func (s *Server) connectPresence(ctx context.Context, topic, subject string, onLost func()) (func(), error) {
	if leased, ok := s.Presence.(realtime.LeasedPresence); ok {
		disconnect, lost, err := leased.ConnectLease(ctx, topic, subject)
		if err != nil {
			return nil, err
		}
		go func() {
			select {
			case <-ctx.Done():
			case <-lost:
				onLost()
			}
		}()
		return disconnect, nil
	}
	return s.Presence.Connect(topic, subject)
}
