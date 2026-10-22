package delivery

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type CloudflareConfig struct {
	AccountID, QueueID, Token, BaseURL string
	Client                             *http.Client
}
type Cloudflare struct {
	endpoint, token string
	client          *http.Client
}

var resourceID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func NewCloudflare(c CloudflareConfig) (*Cloudflare, error) {
	if !resourceID.MatchString(c.AccountID) || !resourceID.MatchString(c.QueueID) || c.Token == "" {
		return nil, ErrInvalid
	}
	if c.BaseURL == "" {
		c.BaseURL = "https://api.cloudflare.com/client/v4"
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, ErrInvalid
	}
	if c.Client == nil {
		c.Client = &http.Client{Timeout: 10 * time.Second}
	}
	// Copy the client: redirects must never forward bearer credentials to another endpoint.
	client := *c.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Cloudflare{strings.TrimRight(c.BaseURL, "/") + "/accounts/" + c.AccountID + "/queues/" + c.QueueID + "/messages", c.Token, &client}, nil
}
func (q *Cloudflare) request(ctx context.Context, path string, body any, result any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, q.endpoint+path, bytes.NewReader(data))
	if err != nil {
		return ErrInvalid
	}
	req.Header.Set("Authorization", "Bearer "+q.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := q.client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrUnavailable
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, (64<<10)+1))
	if err != nil || len(data) > 64<<10 {
		return ErrUnavailable
	}
	var envelope struct {
		Success bool            `json:"success"`
		Result  json.RawMessage `json:"result"`
	}
	if json.Unmarshal(data, &envelope) != nil || !envelope.Success {
		return ErrUnavailable
	}
	if result != nil && (len(envelope.Result) == 0 || json.Unmarshal(envelope.Result, result) != nil) {
		return ErrUnavailable
	}
	return nil
}
func (q *Cloudflare) Publish(ctx context.Context, n Notification) error {
	body, err := encode(n)
	if err != nil {
		return err
	}
	// Text avoids runtime-specific V8 serialization and JSON base64 wrapping.
	return q.request(ctx, "", map[string]any{"body": body, "content_type": "text"}, nil)
}
func (q *Cloudflare) Receive(ctx context.Context, limit int) ([]Message, error) {
	if !validLimit(limit) {
		return nil, ErrInvalid
	}
	var result struct {
		Messages []struct {
			Body     string            `json:"body"`
			Receipt  string            `json:"lease_id"`
			Metadata map[string]string `json:"metadata"`
		} `json:"messages"`
	}
	if err := q.request(ctx, "/pull", map[string]int{"batch_size": limit, "visibility_timeout_ms": 30000}, &result); err != nil {
		return nil, err
	}
	if len(result.Messages) > limit {
		return nil, ErrUnavailable
	}
	messages := make([]Message, 0, len(result.Messages))
	for _, m := range result.Messages {
		body := m.Body
		switch m.Metadata["CF-Content-Type"] {
		case "json", "bytes":
			data, err := base64.StdEncoding.DecodeString(body)
			if err != nil {
				return nil, ErrInvalid
			}
			body = string(data)
		case "", "text":
		default:
			return nil, ErrInvalid
		}
		n, err := decode(body)
		if err != nil || m.Receipt == "" {
			return nil, ErrInvalid
		}
		messages = append(messages, Message{n, m.Receipt})
	}
	return messages, nil
}
func (q *Cloudflare) Ack(ctx context.Context, receipt string) error {
	if receipt == "" {
		return ErrInvalid
	}
	var result struct {
		Count int `json:"ackCount"`
	}
	if err := q.request(ctx, "/ack", map[string]any{"acks": []map[string]string{{"lease_id": receipt}}}, &result); err != nil {
		return err
	}
	if result.Count != 1 {
		return ErrUnavailable
	}
	return nil
}
func (q *Cloudflare) Retry(ctx context.Context, receipt string, delay time.Duration) error {
	if receipt == "" || !validDelay(delay) {
		return ErrInvalid
	}
	var result struct {
		Count int `json:"retryCount"`
	}
	if err := q.request(ctx, "/ack", map[string]any{"retries": []map[string]any{{"lease_id": receipt, "delay_seconds": int(delay / time.Second)}}}, &result); err != nil {
		return err
	}
	if result.Count != 1 {
		return ErrUnavailable
	}
	return nil
}
