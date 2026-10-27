package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// The Engine API preserves fresh sandboxes without spawning a CLI for every lifecycle operation.
type dockerEngine struct {
	http *http.Client
	dial func(context.Context) (net.Conn, error)
}

var localEngine = sync.OnceValues(func() (*dockerEngine, error) {
	host := os.Getenv("DOCKER_HOST")
	if host == "" {
		if _, err := os.Stat("/var/run/docker.sock"); err == nil {
			host = "unix:///var/run/docker.sock"
		} else {
			// Desktop contexts may point at a user-owned socket. Resolve once, never per case.
			output, err := exec.Command("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
			if err != nil {
				return nil, errors.New("Docker endpoint unavailable")
			}
			host = strings.TrimSpace(string(output))
		}
	}
	if !strings.HasPrefix(host, "unix://") {
		return nil, errors.New("judge requires a local Unix Docker socket")
	}
	socket := strings.TrimPrefix(host, "unix://")
	dial := func(ctx context.Context) (net.Conn, error) { return (&net.Dialer{}).DialContext(ctx, "unix", socket) }
	return newDockerEngine(dial), nil
})

func newDockerEngine(dial func(context.Context) (net.Conn, error)) *dockerEngine {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return dial(ctx) }, MaxIdleConnsPerHost: 16}
	return &dockerEngine{http: &http.Client{Transport: transport}, dial: dial}
}

func (d *Docker) engine() (*dockerEngine, error) {
	if d.client != nil {
		return d.client, nil
	}
	return localEngine()
}

const dockerAPI = "/v1.45"

func (d *dockerEngine) request(ctx context.Context, method, path string, input any) (*http.Response, error) {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+dockerAPI+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return d.http.Do(req)
}

func (d *dockerEngine) create(ctx context.Context, name, image string, limits execution.Limits, sqlSandbox bool) error {
	tmpfsSize := "16777216"
	if sqlSandbox {
		tmpfsSize = "134217728"
	}
	config := map[string]any{
		"Image": image, "User": "65534:65534", "OpenStdin": true, "StdinOnce": true,
		"AttachStdin": true, "AttachStdout": true, "AttachStderr": true,
		"HostConfig": map[string]any{
			"NetworkMode": "none", "ReadonlyRootfs": true, "CapDrop": []string{"ALL"},
			"SecurityOpt": []string{"no-new-privileges"}, "Memory": limits.MemoryBytes,
			"MemorySwap": limits.MemoryBytes, "PidsLimit": limits.MaxProcesses, "NanoCpus": int64(1_000_000_000),
			"Tmpfs": map[string]string{"/tmp": "rw,noexec,nosuid,size=" + tmpfsSize},
		},
	}
	response, err := d.request(ctx, "POST", "/containers/create?name="+url.QueryEscape(name), config)
	if err != nil {
		// A lost creation response may still leave a daemon operation in progress.
		return errors.Join(worker.ErrTeardown, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		return fmt.Errorf("sandbox creation failed (%d)", response.StatusCode)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(response.Body, 65536))
	return err
}

func (d *dockerEngine) remove(ctx context.Context, name string) error {
	response, err := d.request(ctx, "DELETE", "/containers/"+url.PathEscape(strings.TrimPrefix(name, "/"))+"?force=true&v=true", nil)
	if err != nil {
		return worker.ErrTeardown
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent && response.StatusCode != http.StatusNotFound {
		return worker.ErrTeardown
	}
	return nil
}

func (d *dockerEngine) run(ctx context.Context, name, image string, limits execution.Limits, input []byte, stdout, stderr io.Writer, sqlSandbox ...bool) (int, error) {
	if err := d.create(ctx, name, image, limits, len(sqlSandbox) > 0 && sqlSandbox[0]); err != nil {
		return 0, err
	}
	conn, err := d.dial(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	path := dockerAPI + "/containers/" + url.PathEscape(strings.TrimPrefix(name, "/")) + "/attach?stream=1&stdin=1&stdout=1&stderr=1"
	req, err := http.NewRequest("POST", "http://docker"+path, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "tcp")
	if err = req.Write(conn); err != nil {
		return 0, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, req)
	if err != nil {
		return 0, err
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		response.Body.Close()
		return 0, fmt.Errorf("sandbox attachment failed (%d)", response.StatusCode)
	}
	// Attach before start; stdin EOF and output have independent halves of this connection.
	inputDone := make(chan error, 1)
	go func() {
		_, err := io.Copy(conn, bytes.NewReader(input))
		if half, ok := conn.(interface{ CloseWrite() error }); ok {
			if e := half.CloseWrite(); err == nil {
				err = e
			}
		} else if err == nil {
			err = errors.New("Docker socket cannot close stdin independently")
		}
		inputDone <- err
	}()
	start, err := d.request(ctx, "POST", "/containers/"+url.PathEscape(strings.TrimPrefix(name, "/"))+"/start", nil)
	if err != nil {
		conn.Close()
		<-inputDone
		return 0, err
	}
	start.Body.Close()
	if start.StatusCode != http.StatusNoContent {
		conn.Close()
		<-inputDone
		return 0, fmt.Errorf("sandbox start failed (%d)", start.StatusCode)
	}
	err = copyDockerStreams(reader, stdout, stderr)
	conn.Close()
	inputErr := <-inputDone
	if err != nil {
		return 0, err
	}
	if inputErr != nil {
		return 0, inputErr
	}
	wait, err := d.request(ctx, "POST", "/containers/"+url.PathEscape(strings.TrimPrefix(name, "/"))+"/wait?condition=not-running", nil)
	if err != nil {
		return 0, err
	}
	defer wait.Body.Close()
	if wait.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("sandbox wait failed (%d)", wait.StatusCode)
	}
	var result struct {
		StatusCode int
		Error      *struct{ Message string }
	}
	if err = json.NewDecoder(io.LimitReader(wait.Body, 65536)).Decode(&result); err != nil {
		return 0, err
	}
	if result.Error != nil {
		return 0, errors.New("sandbox wait failed")
	}
	return result.StatusCode, nil
}

func copyDockerStreams(reader io.Reader, stdout, stderr io.Writer) error {
	var header [8]byte
	for {
		_, err := io.ReadFull(reader, header[:])
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if header[1] != 0 || header[2] != 0 || header[3] != 0 {
			return errors.New("invalid sandbox stream header")
		}
		writer := stdout
		switch header[0] {
		case 1:
		case 2:
			writer = stderr
		default:
			return errors.New("invalid sandbox stream")
		}
		if _, err := io.CopyN(writer, reader, int64(binary.BigEndian.Uint32(header[4:]))); err != nil {
			return err
		}
	}
}

func (d *dockerEngine) attemptContainers(ctx context.Context, attempt string) ([]string, error) {
	filters, _ := json.Marshal(map[string][]string{"name": {"^/quorem-" + regexp.QuoteMeta(attempt) + "-"}})
	response, err := d.request(ctx, "GET", "/containers/json?all=true&filters="+url.QueryEscape(string(filters)), nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, worker.ErrTeardown
	}
	var containers []struct{ Names []string }
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&containers); err != nil {
		return nil, err
	}
	names := []string{}
	for _, container := range containers {
		names = append(names, container.Names...)
	}
	return names, nil
}
