package engine

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

var caseAttempt = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

// RemoteSandbox supervises isolated case containers through an authenticated Worker.
type RemoteSandbox struct {
	endpoint *url.URL
	token    string
	client   *http.Client
}

func NewRemoteSandbox(endpoint, token string) (*RemoteSandbox, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || len(token) < 32 {
		return nil, errors.New("invalid remote sandbox configuration")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme != "https" && !(u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback()))) {
		return nil, errors.New("remote sandbox requires HTTPS")
	}
	if host == "" {
		return nil, errors.New("invalid remote sandbox origin")
	}
	transport := &http.Transport{Proxy: nil, MaxIdleConnsPerHost: 16, IdleConnTimeout: 30 * time.Second}
	return &RemoteSandbox{endpoint: u, token: token, client: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (s *RemoteSandbox) request(ctx context.Context, attempt, method string, body io.Reader) (*http.Request, error) {
	if !caseAttempt.MatchString(attempt) {
		return nil, errors.New("invalid attempt")
	}
	target := *s.endpoint
	target.Path = "/internal/case/" + attempt
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	return req, nil
}

func (s *RemoteSandbox) run(ctx context.Context, attempt, caseToken, language string, limits execution.Limits, data []byte, stdout, stderr io.Writer, onExit func()) (int, error) {
	for attemptNumber := 0; attemptNumber < 5; attemptNumber++ {
		req, err := s.request(ctx, attempt, http.MethodPost, bytes.NewReader(data))
		if err != nil {
			return 0, err
		}
		req.Header.Set("X-Case-Language", language)
		req.Header.Set("X-Case-Token", caseToken)
		req.Header.Set("X-Case-Memory", strconv.FormatInt(limits.MemoryBytes, 10))
		req.Header.Set("X-Case-Processes", strconv.Itoa(limits.MaxProcesses))
		res, err := s.client.Do(req)
		if err != nil {
			return 0, errors.New("case request failed")
		}
		if res.StatusCode == http.StatusOK {
			defer res.Body.Close()
			return copyCaseFrames(res.Body, stdout, stderr, onExit)
		}
		status := res.StatusCode
		res.Body.Close()
		if status != http.StatusConflict || attemptNumber == 4 {
			return 0, fmt.Errorf("case request failed (%d)", status)
		}
		// Conflict is returned before the case is admitted, so retrying cannot replay code.
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return 0, ctx.Err()
		case <-timer.C:
		}
	}
	return 0, errors.New("case request unavailable")
}

func copyCaseFrames(reader io.Reader, stdout, stderr io.Writer, onExit func()) (int, error) {
	var header [8]byte
	var exitCode int
	exited := false
	for {
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
				return 0, fmt.Errorf("case response read failed: %w", err)
			}
			if exited {
				return 0, errors.New("case response truncated after exit")
			}
			return 0, errors.New("case response truncated before exit")
		}
		size := binary.BigEndian.Uint32(header[4:])
		if header[1] != 0 || header[2] != 0 || header[3] != 0 || size > 65536 {
			return 0, errors.New("invalid case frame")
		}
		switch header[0] {
		case 1, 2:
			if exited {
				return 0, errors.New("output after case exit")
			}
			writer := stdout
			if header[0] == 2 {
				writer = stderr
			}
			if _, err := io.CopyN(writer, reader, int64(size)); err != nil {
				if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
					return 0, errors.New("case response truncated before exit")
				}
				return 0, err
			}
		case 3:
			if size != 4 || exited {
				return 0, errors.New("invalid case exit frame")
			}
			var code [4]byte
			if _, err := io.ReadFull(reader, code[:]); err != nil {
				if !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
					return 0, fmt.Errorf("case response read failed: %w", err)
				}
				return 0, errors.New("case response truncated before exit")
			}
			exitCode = int(int32(binary.BigEndian.Uint32(code[:])))
			exited = true
			if onExit != nil {
				onExit()
			}
		case 4:
			if size != 0 || !exited {
				return 0, errors.New("invalid case teardown frame")
			}
			var extra [1]byte
			if n, err := reader.Read(extra[:]); n != 0 || err != io.EOF {
				return 0, errors.New("invalid case response ending")
			}
			return exitCode, nil
		default:
			return 0, errors.New("invalid case frame")
		}
	}
}

func (s *RemoteSandbox) remove(ctx context.Context, attempt, caseToken string) error {
	req, err := s.request(ctx, attempt, http.MethodDelete, nil)
	if err != nil {
		return worker.ErrTeardown
	}
	if caseToken != "" {
		req.Header.Set("X-Case-Token", caseToken)
	}
	res, err := s.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("%w: cleanup deadline: %v", worker.ErrTeardown, ctx.Err())
		}
		return fmt.Errorf("%w: cleanup request failed", worker.ErrTeardown)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1024))
	if res.StatusCode != http.StatusNoContent {
		return fmt.Errorf("%w: cleanup HTTP %d", worker.ErrTeardown, res.StatusCode)
	}
	return nil
}

// CheckConnection authenticates against the case service without starting a case.
func (s *RemoteSandbox) CheckConnection(ctx context.Context) error {
	req, err := s.request(ctx, "ready", http.MethodGet, nil)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return errors.New("case service request failed")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return fmt.Errorf("case service request failed (%d)", res.StatusCode)
	}
	return nil
}
