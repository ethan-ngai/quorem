package eventbus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// AppSync relays notices through Events, using only server-side IAM or API-key credentials.
type AppSync struct {
	HTTPURL, WebSocketURL, Region, APIKey string
	Credentials                           aws.CredentialsProvider
	Client                                *http.Client
}

func (a *AppSync) authorize(ctx context.Context, body []byte) (map[string]string, error) {
	u, err := endpoint(a.HTTPURL, false)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{"host": u.Host}
	if a.APIKey != "" {
		headers["x-api-key"] = a.APIKey
		return headers, nil
	}
	if a.Credentials == nil || a.Region == "" {
		return nil, errors.New("AppSync IAM credentials and region required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.HTTPURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("accept", "application/json, text/javascript")
	req.Header.Set("content-encoding", "amz-1.0")
	req.Header.Set("content-type", "application/json; charset=UTF-8")
	creds, err := a.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, unavailable
	}
	sum := sha256.Sum256(body)
	if err = v4.NewSigner().SignHTTP(ctx, creds, req, hex.EncodeToString(sum[:]), "appsync", a.Region, time.Now()); err != nil {
		return nil, unavailable
	}
	for k, v := range req.Header {
		headers[strings.ToLower(k)] = v[0]
	}
	return headers, nil
}

func (a *AppSync) Publish(ctx context.Context, channel string, n realtime.Notice) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if !validNotice(channel, n) {
		return errors.New("invalid event notice")
	}
	event, _ := json.Marshal(n)
	body, _ := json.Marshal(map[string]any{"channel": channel, "events": []string{string(event)}})
	headers, err := a.authorize(ctx, body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.HTTPURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	for k, v := range headers {
		if k != "host" {
			req.Header.Set(k, v)
		}
	}
	if req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := privateClient(a.Client)
	res, err := client.Do(req)
	if err != nil {
		return unavailable
	}
	var result struct {
		Successful []json.RawMessage `json:"successful"`
		Failed     []json.RawMessage `json:"failed"`
	}
	if err = responseJSON(res, &result); err != nil {
		return err
	}
	if len(result.Failed) != 0 || len(result.Successful) != 1 {
		return unavailable
	}
	return nil
}

func (a *AppSync) Subscribe(ctx context.Context, channel string) (<-chan realtime.Notice, func(), error) {
	if !channelPattern.MatchString(channel) {
		return nil, nil, errors.New("invalid event channel")
	}
	if _, err := endpoint(a.WebSocketURL, true); err != nil {
		return nil, nil, err
	}
	boot, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	headers, err := a.authorize(boot, []byte("{}"))
	if err != nil {
		return nil, nil, err
	}
	encoded, _ := json.Marshal(headers)
	conn, _, err := websocket.Dial(boot, a.WebSocketURL, &websocket.DialOptions{Subprotocols: []string{"aws-appsync-event-ws", "header-" + base64.RawURLEncoding.EncodeToString(encoded)}, HTTPClient: privateClient(a.Client)})
	if err != nil {
		return nil, nil, unavailable
	}
	conn.SetReadLimit(64 << 10)
	fail := func() (<-chan realtime.Notice, func(), error) { conn.CloseNow(); return nil, nil, unavailable }
	if writeJSON(boot, conn, map[string]string{"type": "connection_init"}) != nil {
		return fail()
	}
	idle, err := connectionAck(boot, conn)
	if err != nil {
		return fail()
	}
	body, _ := json.Marshal(map[string]string{"channel": channel})
	authorization, err := a.authorize(boot, body)
	if err != nil {
		return fail()
	}
	const id = "quorem"
	if writeJSON(boot, conn, map[string]any{"type": "subscribe", "id": id, "channel": channel, "authorization": authorization}) != nil {
		return fail()
	}
	if err = expectFrame(boot, conn, "subscribe_success"); err != nil {
		return fail()
	}
	return readNotices(ctx, conn, channel, idle, func(body []byte) ([]realtime.Notice, error) {
		var frame struct {
			Type  string   `json:"type"`
			ID    string   `json:"id"`
			Event []string `json:"event"`
		}
		if json.Unmarshal(body, &frame) != nil {
			return nil, unavailable
		}
		if frame.Type == "ka" {
			return nil, nil
		}
		if frame.Type != "data" || frame.ID != id {
			return nil, unavailable
		}
		notices := make([]realtime.Notice, 0, len(frame.Event))
		for _, event := range frame.Event {
			var n realtime.Notice
			if json.Unmarshal([]byte(event), &n) != nil {
				return nil, unavailable
			}
			notices = append(notices, n)
		}
		return notices, nil
	})
}
func expectFrame(ctx context.Context, conn *websocket.Conn, want string) error {
	for {
		_, body, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var f struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(body, &f) != nil {
			return unavailable
		}
		if f.Type == "ka" {
			continue
		}
		if f.Type != want {
			return unavailable
		}
		return nil
	}
}

var _ realtime.PubSub = (*AppSync)(nil)

func connectionAck(ctx context.Context, conn *websocket.Conn) (time.Duration, error) {
	_, body, err := conn.Read(ctx)
	if err != nil {
		return 0, err
	}
	var f struct {
		Type    string `json:"type"`
		Timeout int    `json:"connectionTimeoutMs"`
	}
	if json.Unmarshal(body, &f) != nil || f.Type != "connection_ack" || f.Timeout <= 0 || f.Timeout > 300000 {
		return 0, unavailable
	}
	return time.Duration(f.Timeout) * time.Millisecond, nil
}
