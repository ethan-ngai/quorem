// Package eventbus translates managed fanout protocols; application authority stays in PostgreSQL.
package eventbus

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

var channelPattern = regexp.MustCompile(`^/(matches|match-invites|interviews|memberships)/[0-9a-fA-F-]{36}$`)
var unavailable = errors.New("event transport unavailable")

func endpoint(raw string, websocketURL bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid event endpoint")
	}
	secure, local := "https", "http"
	if websocketURL {
		secure, local = "wss", "ws"
	}
	if u.Scheme != secure && !(u.Scheme == local && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, errors.New("event endpoint requires TLS")
	}
	return u, nil
}

func validNotice(channel string, n realtime.Notice) bool {
	return channelPattern.MatchString(channel) && n.AggregateID != "" && (channel == "/matches/"+n.AggregateID || channel == "/match-invites/"+n.AggregateID || channel == "/interviews/"+n.AggregateID || channel == "/memberships/"+n.AggregateID) && n.ID != "" && len(n.ID) <= 128 && len(n.Type) <= 128 && len(n.Version) <= 32 && !n.OccurredAt.IsZero()
}

func responseJSON(res *http.Response, target any) error {
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return unavailable
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(target); err != nil {
		return unavailable
	}
	return nil
}

func writeJSON(ctx context.Context, c *websocket.Conn, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.Write(ctx, websocket.MessageText, body)
}

// readNotices coalesces slow consumers; every notice triggers an authorized snapshot read.
func readNotices(ctx context.Context, conn *websocket.Conn, channel string, idle time.Duration, decode func([]byte) ([]realtime.Notice, error)) (<-chan realtime.Notice, func(), error) {
	ctx, cancel := context.WithCancel(ctx)
	notices := make(chan realtime.Notice, 1)
	conn.SetReadLimit(64 << 10)
	go func() {
		defer close(notices)
		defer cancel()
		defer conn.CloseNow()
		for {
			readCtx, stop := context.WithCancel(ctx)
			if idle > 0 {
				stop()
				readCtx, stop = context.WithTimeout(ctx, idle)
			}
			_, body, err := conn.Read(readCtx)
			stop()
			if err != nil {
				return
			}
			entries, err := decode(body)
			if err != nil {
				return
			}
			for _, n := range entries {
				if !validNotice(channel, n) {
					return
				}
				select {
				case notices <- n:
				default:
					select {
					case previous := <-notices:
						n = realtime.CoalesceNotice(previous, n)
					default:
					}
					select {
					case notices <- n:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()
	return notices, func() { cancel(); conn.CloseNow() }, nil
}

// Reject redirects before any server credential can reach a different endpoint.
func privateClient(client *http.Client) *http.Client {
	result := http.Client{Timeout: 5 * time.Second}
	if client != nil {
		result = *client
	}
	result.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &result
}
