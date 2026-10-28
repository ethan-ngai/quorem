package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/eventbus"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

const loadRoomSize = 8
const loadOrigin = "https://load.example.test"

type loadVerifier struct{ prefix string }

func (v loadVerifier) Verify(_ context.Context, token string) (identity.Principal, error) {
	if !strings.HasPrefix(token, v.prefix) {
		return identity.Principal{}, identity.ErrUnauthorized
	}
	return identity.Principal{UserID: token, SessionID: "synthetic-load", EmailVerified: true}, nil
}

type loadNotice struct {
	kind     string
	received time.Time
}
type loadFrame struct {
	Type  string          `json:"type"`
	ID    string          `json:"id"`
	Kind  string          `json:"kind"`
	Value json.RawMessage `json:"value"`
	Error *struct {
		Code   string `json:"code"`
		Status int    `json:"status"`
	} `json:"error"`
}
type loadRPCError struct{ status int }

func (e loadRPCError) Error() string {
	return fmt.Sprintf("socket command denied (status %d)", e.status)
}

type loadSocket struct {
	conn    *websocket.Conn
	notices chan loadNotice
	ready   chan struct{}
	done    chan struct{}
	readErr error
	mu      sync.Mutex
	pending map[string]chan loadFrame
	next    atomic.Uint64
}

func newLoadSocket(ctx context.Context, conn *websocket.Conn) *loadSocket {
	client := &loadSocket{conn: conn, notices: make(chan loadNotice, 64), done: make(chan struct{}), ready: make(chan struct{}), pending: make(map[string]chan loadFrame)}
	go func() {
		var ready sync.Once
		defer close(client.done)
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				client.readErr = err
				return
			}
			var frame loadFrame
			if json.Unmarshal(data, &frame) != nil {
				client.readErr = errors.New("invalid socket frame")
				return
			}
			ready.Do(func() { close(client.ready) })
			if frame.ID != "" {
				client.mu.Lock()
				response := client.pending[frame.ID]
				client.mu.Unlock()
				if response != nil {
					select {
					case response <- frame:
					default:
					}
				}
			} else if frame.Type == "changed" {
				select {
				case client.notices <- loadNotice{frame.Kind, time.Now()}:
				default:
				}
			}
		}
	}()
	return client
}
func (c *loadSocket) request(ctx context.Context, kind string, body map[string]any) (json.RawMessage, error) {
	if body == nil {
		body = map[string]any{}
	}
	id := strconv.FormatUint(c.next.Add(1), 10)
	response := make(chan loadFrame, 1)
	c.mu.Lock()
	c.pending[id] = response
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	body["id"] = id
	body["type"] = kind
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	if err = c.conn.Write(ctx, websocket.MessageText, data); err != nil {
		return nil, err
	}
	select {
	case frame := <-response:
		if frame.Error != nil {
			return nil, loadRPCError{frame.Error.Status}
		}
		return frame.Value, nil
	case <-c.done:
		return nil, c.readErr
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (c *loadSocket) documentNotice(ctx context.Context, started time.Time) (time.Duration, error) {
	for {
		select {
		case notice := <-c.notices:
			if notice.kind == "interview.document" && !notice.received.Before(started) {
				return notice.received.Sub(started), nil
			}
		case <-c.done:
			return 0, c.readErr
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
}

func loadParallel(ctx context.Context, count, workers int, run func(int) error) error {
	jobs := make(chan int)
	failures := make(chan error, 1)
	var group sync.WaitGroup
	for range workers {
		group.Go(func() {
			for i := range jobs {
				if ctx.Err() != nil {
					return
				}
				if err := run(i); err != nil {
					select {
					case failures <- err:
					default:
					}
					return
				}
			}
		})
	}
	for i := 0; i < count; i++ {
		select {
		case jobs <- i:
		case err := <-failures:
			close(jobs)
			group.Wait()
			return err
		case <-ctx.Done():
			close(jobs)
			group.Wait()
			return ctx.Err()
		}
	}
	close(jobs)
	group.Wait()
	select {
	case err := <-failures:
		return err
	default:
		return nil
	}
}

// Opt-in fixture load: real PostgreSQL and sockets; JWT verification alone is replaced.
func TestDistributedInterviewLoad(t *testing.T) {
	requested := os.Getenv("QUOREM_TEST_LOAD_CLIENTS")
	if requested == "" {
		t.Skip("QUOREM_TEST_LOAD_CLIENTS enables the isolated distributed socket load")
	}
	count, err := strconv.Atoi(requested)
	if err != nil || count < loadRoomSize || count > 4096 || count%loadRoomSize != 0 {
		t.Fatal("client count must be a multiple of 8 between 8 and 4096")
	}
	holdSeconds := 35
	if configured := os.Getenv("QUOREM_TEST_LOAD_HOLD_SECONDS"); configured != "" {
		holdSeconds, err = strconv.Atoi(configured)
		if err != nil || holdSeconds < 0 || holdSeconds > 120 {
			t.Fatal("hold seconds must be between 0 and 120")
		}
	}
	databaseURL := os.Getenv("QUOREM_TEST_DATABASE_URL")
	parsed, err := url.Parse(databaseURL)
	if err != nil || parsed.Path != "/quorem_load_194" || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		t.Fatal("load tests require the separate disposable quorem_load_194 database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	setup, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal("load database unavailable")
	}
	defer setup.Pool.Close()
	if err = setup.Migrate(ctx, "../../migrations"); err != nil {
		t.Fatal("load database migration", err)
	}
	prefix := "load-" + postgres.ID() + "-"
	rooms := count / loadRoomSize
	if err = seedLoadRooms(ctx, setup, prefix, count, rooms); err != nil {
		t.Fatal("synthetic seed", err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		for _, query := range []string{`DELETE FROM interviews WHERE host_id LIKE $1`, `DELETE FROM entitlement_grants WHERE user_id LIKE $1`, `DELETE FROM users WHERE id LIKE $1`} {
			if _, err := setup.Pool.Exec(cleanup, query, prefix+"%"); err != nil {
				t.Error("synthetic cleanup", err)
				return
			}
		}
	}()

	servers := make([]*httptest.Server, 2)
	apis := make([]*Server, 2)
	replicaStores := make([]*postgres.Store, 2)
	serverCtx, stopServers := context.WithCancel(ctx)
	defer func() {
		stopServers()
		for _, server := range servers {
			if server != nil {
				server.Close()
			}
		}
		for _, store := range replicaStores {
			if store != nil {
				store.Pool.Close()
			}
		}
	}()
	// This density is explicit test configuration, above the production 512-socket default.
	socketLimit := (count+1)/2 + 16
	for i := range servers {
		store, e := postgres.Open(ctx, databaseURL)
		if e != nil {
			t.Fatal("replica database", e)
		}
		replicaStores[i] = store
		bus, e := eventbus.NewPostgres(serverCtx, databaseURL, databaseURL, socketLimit)
		if e != nil {
			t.Fatal("replica fanout", e)
		}
		api := &Server{Store: store, Identity: loadVerifier{prefix}, Origins: []string{loadOrigin}, Events: bus, Presence: postgres.NewPresence(serverCtx, store.Pool)}
		apis[i] = api
		if err := api.StartRealtime(serverCtx); err != nil {
			t.Fatal(err)
		}
		servers[i] = httptest.NewServer(WithCapacity(api.Handler(), 32, socketLimit))
	}
	clients := make([]*loadSocket, count)
	defer func() {
		for _, client := range clients {
			if client != nil {
				client.conn.CloseNow()
			}
		}
	}()
	roomIDs := make([]string, rooms)
	epochs := make([]string, rooms)
	for room := range rooms {
		if err = setup.Pool.QueryRow(ctx, `SELECT id,document_epoch FROM interviews WHERE invite_hash=$1`, prefix+"invite-"+strconv.Itoa(room)).Scan(&roomIDs[room], &epochs[room]); err != nil {
			t.Fatal("room seed lookup", err)
		}
	}
	dialLatencies := make([]time.Duration, count)
	connected := time.Now()
	if err = loadParallel(ctx, count, 16, func(i int) error {
		started := time.Now()
		dialCtx, done := context.WithTimeout(ctx, 10*time.Second)
		defer done()
		endpoint := "ws" + strings.TrimPrefix(servers[i%2].URL, "http") + "/v1/interviews/" + roomIDs[i/loadRoomSize] + "/events"
		conn, _, e := websocket.Dial(dialCtx, endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{loadOrigin}}, Subprotocols: []string{"quorem", "bearer." + prefix + strconv.Itoa(i)}})
		if e != nil {
			return errors.New("fixture socket connection failed")
		}
		clients[i] = newLoadSocket(ctx, conn)
		select {
		case <-clients[i].ready:
			dialLatencies[i] = time.Since(started)
			return nil
		case <-clients[i].done:
			return errors.New("socket closed before admission completed")
		case <-dialCtx.Done():
			conn.CloseNow()
			return errors.New("socket admission deadline exceeded")
		}
	}); err != nil {
		t.Fatal("bounded connection ramp", err)
	}
	connectionTime := time.Since(connected)

	latencies := make([]time.Duration, count)
	if err = loadParallel(ctx, rooms, 8, func(room int) error {
		writerIndex := room * loadRoomSize
		writer, reader := clients[writerIndex], clients[writerIndex+1]
		exercise, done := context.WithTimeout(ctx, 10*time.Second)
		defer done()
		raw, e := reader.request(exercise, "snapshot", nil)
		if e != nil {
			return e
		}
		if strings.Contains(string(raw), "987654321") {
			return errors.New("private fixture escaped to an interviewee")
		}
		started := time.Now()
		push := interviews.Push{Epoch: epochs[room], Version: 0, Updates: []interviews.Update{{ClientID: "synthetic-writer", Changes: json.RawMessage(`[[0,"# synthetic edit"]]`)}}}
		if _, e = writer.request(exercise, "push", map[string]any{"key": postgres.ID(), "push": push}); e != nil {
			return e
		}
		for offset := range loadRoomSize {
			elapsed, e := clients[writerIndex+offset].documentNotice(exercise, started)
			if e != nil {
				return errors.New("committed edit notice missing")
			}
			latencies[writerIndex+offset] = elapsed
		}
		raw, e = reader.request(exercise, "pull", map[string]any{"epoch": epochs[room], "version": 0})
		if e != nil {
			return e
		}
		var updates interviews.Updates
		if json.Unmarshal(raw, &updates) != nil || updates.Version != 1 || len(updates.Updates) != 1 {
			return errors.New("cross-replica edit recovery mismatch")
		}
		return nil
	}); err != nil {
		t.Fatal("cross-replica edit correctness", err)
	}

	// Cursor state and shared connection presence must agree across replicas.
	presenceCtx, donePresence := context.WithTimeout(ctx, 10*time.Second)
	defer donePresence()
	for _, i := range []int{0, 1} {
		_, err = clients[i].request(presenceCtx, "presence", map[string]any{"presence": interviews.PresenceInput{ClientID: "synthetic-" + strconv.Itoa(i), Epoch: epochs[0], Version: 1}})
		if err != nil {
			t.Fatal("cross-replica cursor publish", err)
		}
	}
	raw, err := clients[0].request(presenceCtx, "peers", nil)
	var peers []interviews.Presence
	if err != nil || json.Unmarshal(raw, &peers) != nil || len(peers) != 2 {
		t.Fatal("cross-replica cursor readback")
	}
	topic := "/interviews/" + roomIDs[0]
	if !apis[0].Presence.Online(topic, prefix+"1") || !apis[1].Presence.Online(topic, prefix+"0") {
		t.Fatal("shared online presence disagrees across replicas")
	}
	if _, err = replicaStores[0].RemoveInterviewMember(presenceCtx, prefix+"0", roomIDs[0], postgres.ID(), prefix+"1"); err != nil {
		t.Fatal("revocation mutation", err)
	}
	_, err = clients[1].request(presenceCtx, "snapshot", nil)
	denied := func(err error) bool {
		var response loadRPCError
		return (errors.As(err, &response) && (response.status == 404 || response.status == 403)) || websocket.CloseStatus(err) == websocket.StatusPolicyViolation
	}
	if err == nil {
		t.Fatal("revoked member received a successful socket response")
	}
	if !denied(err) {
		// A close racing the command write can surface as a transport error first.
		select {
		case <-clients[1].done:
			if !denied(clients[1].readErr) {
				t.Fatal("revocation did not deny access")
			}
		case <-presenceCtx.Done():
			t.Fatal("revocation close was not observed")
		}
	}
	raw, err = clients[0].request(presenceCtx, "peers", nil)
	if err != nil || json.Unmarshal(raw, &peers) != nil || len(peers) != 1 {
		t.Fatal("revoked member remains in cursor presence")
	}
	hold := time.NewTimer(time.Duration(holdSeconds) * time.Second)
	defer hold.Stop()
	check := time.NewTicker(time.Second)
	defer check.Stop()
	holding := true
	for holding {
		select {
		case <-hold.C:
			holding = false
		case <-check.C:
			for i, client := range clients {
				if i == 1 {
					continue
				}
				select {
				case <-client.done:
					t.Fatal("authorized socket disconnected during lease renewal")
				default:
				}
			}
		case <-ctx.Done():
			t.Fatal("connected hold deadline exceeded")
		}
	}
	if holdSeconds > 30 {
		var leased int
		if err = setup.Pool.QueryRow(ctx, `SELECT count(*) FROM realtime_presence_leases WHERE subject LIKE $1 AND expires_at>clock_timestamp()`, prefix+"%").Scan(&leased); err != nil || leased != count-1 {
			t.Fatalf("renewed lease count=%d expected=%d", leased, count-1)
		}
	}
	for i, client := range clients {
		if i == 1 {
			continue
		}
		select {
		case <-client.done:
			t.Fatal("authorized socket disconnected during load")
		default:
		}
	}
	sorted := append([]time.Duration{}, latencies...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	percentile := func(percent int) time.Duration { return sorted[(len(sorted)-1)*percent/100] }
	sort.Slice(dialLatencies, func(i, j int) bool { return dialLatencies[i] < dialLatencies[j] })
	dialPercentile := func(percent int) float64 {
		return float64(dialLatencies[(len(dialLatencies)-1)*percent/100]) / float64(time.Millisecond)
	}
	t.Logf("local_distributed_load clients=%d replicas=2 rooms=%d dial_concurrency=16 exercise_concurrency=8 replica_socket_limit=%d hold_seconds=%d connection_ramp_ms=%d connections_per_second=%.1f connection_p50_ms=%.3f connection_p95_ms=%.3f delivery_samples=%d delivery_p50_ms=%.3f delivery_p95_ms=%.3f authorized_disconnects=0 jwt_verification=stub", count, rooms, socketLimit, holdSeconds, connectionTime.Milliseconds(), float64(count)/connectionTime.Seconds(), dialPercentile(50), dialPercentile(95), len(sorted), float64(percentile(50))/float64(time.Millisecond), float64(percentile(95))/float64(time.Millisecond))
}

func seedLoadRooms(ctx context.Context, store *postgres.Store, prefix string, count, rooms int) error {
	fixture := problems.Fixture{Problem: problems.Problem{QuestionDefinition: problems.QuestionDefinition{Title: "Synthetic load question", StatementMarkdown: "Increment the value.", Signature: problems.Signature{ClassName: "Solution", MethodName: "increment", Parameters: []problems.Parameter{{Name: "n", Type: "int"}}, ReturnType: "int"}}}, HiddenCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`987654321`)}, Expected: json.RawMessage(`987654322`)}}}
	encoded, err := json.Marshal(fixture)
	if err != nil {
		return err
	}
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users(id,display_name) SELECT $1||n,'Synthetic load participant' FROM generate_series(0,$2::int-1)n`, []any{prefix, count}},
		{`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) SELECT gen_random_uuid(),$1||(n*8),'interviews.host','manual','distributed-load','synthetic','load fixture' FROM generate_series(0,$2::int-1)n`, []any{prefix, rooms}},
		{`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,invite_hash,invite_token,question_epoch,interviewer_invite_hash,interviewer_invite_token) SELECT md5($1||'room-'||n)::uuid,$1||(n*8),'Synthetic room',$3::jsonb,'python','',md5($1||'document-'||n)::uuid,$1||'invite-'||n,$1||'token-'||n,md5($1||'question-'||n)::uuid,$1||'staff-'||n,$1||'staff-token-'||n FROM generate_series(0,$2::int-1)n`, []any{prefix, rooms, encoded}},
		{`INSERT INTO interview_members(session_id,user_id,role) SELECT md5($1||'room-'||(n/8))::uuid,$1||n,CASE WHEN n%8=0 THEN 'interviewer' ELSE 'interviewee' END FROM generate_series(0,$2::int-1)n`, []any{prefix, count}},
	}
	for _, statement := range statements {
		if _, err = tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
