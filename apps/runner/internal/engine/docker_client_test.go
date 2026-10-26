package engine

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func dockerFrame(writer io.Writer, stream byte, data []byte) {
	var header [8]byte
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(data)))
	writer.Write(header[:])
	writer.Write(data)
}

// Exercise real HTTP upgrade, half-close and multiplexing without requiring a daemon.
func fakeEngine(t *testing.T, execute func([]byte, io.Writer)) (*dockerEngine, <-chan map[string]any) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "quorem-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	listener, err := net.Listen("unix", dir+"/socket")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	var once sync.Once
	configs := make(chan map[string]any, 16)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/create"):
			var config map[string]any
			json.NewDecoder(r.Body).Decode(&config)
			configs <- config
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"Id":"fixture"}`)
		case strings.HasSuffix(r.URL.Path, "/attach"):
			conn, buffer, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return
			}
			defer conn.Close()
			io.WriteString(buffer, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
			buffer.Flush()
			input, _ := io.ReadAll(buffer)
			<-started
			execute(input, conn)
		case strings.HasSuffix(r.URL.Path, "/start"):
			once.Do(func() { close(started) })
			w.WriteHeader(http.StatusNoContent)
		case strings.HasSuffix(r.URL.Path, "/wait"):
			io.WriteString(w, `{"StatusCode":0}`)
		case r.Method == "DELETE":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	dial := func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", dir+"/socket")
	}
	client := newDockerEngine(dial)
	t.Cleanup(client.http.CloseIdleConnections)
	return client, configs
}

func TestDockerEnginePreservesIsolationAndStreamFraming(t *testing.T) {
	client, configs := fakeEngine(t, func(input []byte, writer io.Writer) {
		if string(input) != "request" {
			t.Errorf("stdin: %q", input)
		}
		dockerFrame(writer, 1, []byte{0})
		dockerFrame(writer, 2, []byte("diagnostic"))
		dockerFrame(writer, 1, []byte(`{"status":"executed","actual":1}`))
	})
	var out, stderr bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	code, err := client.run(ctx, "case", "image", execution.DefaultLimits(), []byte("request"), &out, &stderr)
	if err != nil || code != 0 || !bytes.HasPrefix(out.Bytes(), []byte{0}) || stderr.String() != "diagnostic" {
		t.Fatalf("code=%d err=%v output=%q stderr=%q", code, err, out.Bytes(), stderr.String())
	}
	config := <-configs
	host := config["HostConfig"].(map[string]any)
	if config["User"] != "65534:65534" || host["NetworkMode"] != "none" || host["ReadonlyRootfs"] != true || host["Memory"] != float64(256<<20) || host["MemorySwap"] != host["Memory"] || host["PidsLimit"] != float64(16) || host["NanoCpus"] != float64(1e9) {
		t.Fatalf("sandbox restrictions changed: %+v", config)
	}
	if host["SecurityOpt"].([]any)[0] != "no-new-privileges" || host["CapDrop"].([]any)[0] != "ALL" || host["Tmpfs"].(map[string]any)["/tmp"] != "rw,noexec,nosuid,size=16777216" {
		t.Fatal(host)
	}
	if _, ok := config["Env"]; ok {
		t.Fatal("host environment forwarded")
	}
	if err = client.remove(ctx, "case"); err != nil {
		t.Fatal(err)
	}
}

func TestDockerEngineRejectsUnconfirmedTeardown(t *testing.T) {
	client := &dockerEngine{http: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusInternalServerError, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}}
	if !errors.Is(client.remove(context.Background(), "case"), worker.ErrTeardown) {
		t.Fatal("accepted uncertain cleanup")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDockerStreamRejectsTruncationAndInvalidChannels(t *testing.T) {
	for _, data := range [][]byte{{1, 0, 0}, {3, 0, 0, 0, 0, 0, 0, 0}, {1, 0, 0, 0, 0, 0, 0, 5, 'x'}} {
		if copyDockerStreams(bytes.NewReader(data), io.Discard, io.Discard) == nil {
			t.Fatalf("accepted invalid stream %v", data)
		}
	}
}
