package delivery

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"time"
)

type Publisher interface {
	Publish(context.Context, Notification) error
}

type DispatchConfig struct {
	URL, Token string
	Client     *http.Client
}
type Dispatch struct {
	endpoint, token string
	client          *http.Client
}

// Dispatch publishes wakeups through an app-owned queue binding, without cloud-admin credentials.
func NewDispatch(c DispatchConfig) (*Dispatch, error) {
	u, err := url.Parse(c.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(c.Token) < 32 {
		return nil, ErrInvalid
	}
	client := http.Client{Timeout: 2 * time.Second}
	if c.Client != nil {
		client = *c.Client
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Dispatch{endpoint: c.URL, token: c.Token, client: &client}, nil
}
func (d *Dispatch) Publish(ctx context.Context, n Notification) error {
	body, err := encode(n)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewBufferString(body))
	if err != nil {
		return ErrInvalid
	}
	req.Header.Set("Authorization", "Bearer "+d.token)
	req.Header.Set("Content-Type", "application/json")
	response, err := d.client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusNoContent {
		return ErrUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1025))
	if err != nil || len(data) > 1024 {
		return ErrUnavailable
	}
	return nil
}
