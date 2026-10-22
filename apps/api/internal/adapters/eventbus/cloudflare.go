package eventbus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// Cloudflare connects API instances to a private Durable Object relay, never directly to browsers.
type Cloudflare struct {
	URL, Token string
	Client     *http.Client
}

func (c *Cloudflare) target(channel string, ws bool) (string, error) {
	if !channelPattern.MatchString(channel) || len(c.Token) < 32 {
		return "", errors.New("invalid relay channel or credentials")
	}
	u, err := endpoint(c.URL, false)
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + channel
	if ws {
		u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	}
	return u.String(), nil
}
func (c *Cloudflare) Publish(ctx context.Context, channel string, n realtime.Notice) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if !validNotice(channel, n) {
		return errors.New("invalid event notice")
	}
	target, err := c.target(channel, false)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(n)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	client := privateClient(c.Client)
	res, err := client.Do(req)
	if err != nil {
		return unavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return unavailable
	}
	return nil
}
func (c *Cloudflare) Subscribe(ctx context.Context, channel string) (<-chan realtime.Notice, func(), error) {
	target, err := c.target(channel, true)
	if err != nil {
		return nil, nil, err
	}
	boot, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(boot, target, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + c.Token}}, HTTPClient: privateClient(c.Client)})
	if err != nil {
		return nil, nil, unavailable
	}
	return readNotices(ctx, conn, channel, 0, func(body []byte) ([]realtime.Notice, error) {
		var n realtime.Notice
		if json.Unmarshal(body, &n) != nil {
			return nil, unavailable
		}
		return []realtime.Notice{n}, nil
	})
}

var _ realtime.PubSub = (*Cloudflare)(nil)
