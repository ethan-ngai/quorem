// Read-only production profiling reuses the application's queries without printing their data.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type statement struct {
	sql     string
	args    []any
	started time.Time
}
type traceKey struct{}
type capture struct {
	sync.Mutex
	statements []statement
}

func (c *capture) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, traceKey{}, statement{d.SQL, append([]any(nil), d.Args...), time.Now()})
}
func (c *capture) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	s, ok := ctx.Value(traceKey{}).(statement)
	if !ok || !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s.sql)), "SELECT") {
		return
	}
	c.Lock()
	c.statements = append(c.statements, s)
	c.Unlock()
}
func (c *capture) take() []statement {
	c.Lock()
	defer c.Unlock()
	s := c.statements
	c.statements = nil
	return s
}

type timing struct {
	Name      string    `json:"name"`
	SamplesMS []float64 `json:"samples_ms"`
	MedianMS  float64   `json:"median_ms"`
	Bytes     int       `json:"response_bytes"`
}
type plan struct {
	Planning  float64 `json:"Planning Time"`
	Execution float64 `json:"Execution Time"`
	Plan      struct {
		Rows  float64 `json:"Actual Rows"`
		Hits  int     `json:"Shared Hit Blocks"`
		Reads int     `json:"Shared Read Blocks"`
	} `json:"Plan"`
}
type sqlTiming struct {
	Name        string  `json:"name"`
	PlanningMS  float64 `json:"planning_ms"`
	ExecutionMS float64 `json:"execution_ms"`
	Rows        float64 `json:"rows"`
	Hits        int     `json:"shared_hits"`
	Reads       int     `json:"shared_reads"`
}
type report struct {
	stage        string
	ReadOnly     bool        `json:"read_only"`
	ConnectionMS float64     `json:"connection_ms"`
	CatalogRows  int         `json:"catalog_rows"`
	Calls        []timing    `json:"calls"`
	SQL          []sqlTiming `json:"sql"`
}

func ms(start time.Time) float64 { return float64(time.Since(start).Microseconds()) / 1000 }
func run(ctx context.Context) (report, error) {
	r := report{stage: "configuration"}
	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		return r, err
	}
	cfg.MaxConns = 1
	cfg.MinConns = 0
	cfg.MinIdleConns = 0
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	// Proxies may reject nonstandard startup parameters; establish policy before any reads.
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		for _, sql := range []string{"SET SESSION default_transaction_read_only=on", "SET SESSION statement_timeout=3000", "SET SESSION lock_timeout=1000"} {
			if _, err := conn.Exec(ctx, sql); err != nil {
				return err
			}
		}
		return nil
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = "quorem-read-profile"
	tracer := &capture{}
	cfg.ConnConfig.Tracer = tracer
	r.stage = "connection"
	started := time.Now()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return r, err
	}
	defer pool.Close()
	var policy string
	if err = pool.QueryRow(ctx, "SHOW default_transaction_read_only").Scan(&policy); err != nil {
		return r, err
	}
	r.ConnectionMS = ms(started)
	r.ReadOnly = policy == "on"
	if !r.ReadOnly {
		return r, fmt.Errorf("read-only session required")
	}
	tracer.take()
	store := &postgres.Store{Pool: pool}
	var slug, id string
	operations := []struct {
		name string
		call func() (any, error)
	}{
		{"catalog", func() (any, error) {
			page, e := store.ProblemCatalog(ctx, postgres.ProblemFilter{Page: 1, Limit: 30})
			if e == nil {
				r.CatalogRows = len(page.Items)
				if len(page.Items) > 0 {
					slug = page.Items[0].Slug
					id = page.Items[0].ID
				}
			}
			return page, e
		}},
		{"problem_slug", func() (any, error) { return store.Problem(ctx, slug, false) }},
		{"problem_version", func() (any, error) { return store.Problem(ctx, id, true) }},
	}
	for _, op := range operations {
		r.stage = op.name
		t := timing{Name: op.name}
		var queries []statement
		for sample := 0; sample < 5; sample++ {
			tracer.take()
			start := time.Now()
			data, e := op.call()
			if e != nil {
				return r, e
			}
			elapsed := ms(start)
			captured := tracer.take()
			if sample == 0 {
				queries = captured
			}
			encoded, e := json.Marshal(data)
			if e != nil {
				return r, e
			}
			t.Bytes = len(encoded)
			t.SamplesMS = append(t.SamplesMS, elapsed)
		}
		ordered := append([]float64(nil), t.SamplesMS...)
		sort.Float64s(ordered)
		t.MedianMS = ordered[len(ordered)/2]
		r.Calls = append(r.Calls, t)
		// Only SELECT statements captured from real reads can be explained; no arbitrary SQL input.
		for index, q := range queries {
			r.stage = fmt.Sprintf("%s_plan_%d", op.name, index+1)
			tx, e := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
			if e != nil {
				return r, e
			}
			var raw []byte
			e = tx.QueryRow(ctx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+q.sql, q.args...).Scan(&raw)
			_ = tx.Rollback(ctx)
			if e != nil {
				return r, e
			}
			var plans []plan
			if e = json.Unmarshal(raw, &plans); e != nil || len(plans) != 1 {
				return r, fmt.Errorf("invalid query plan: %w", e)
			}
			p := plans[0]
			r.SQL = append(r.SQL, sqlTiming{fmt.Sprintf("%s_sql_%d", op.name, index+1), p.Planning, p.Execution, p.Plan.Rows, p.Plan.Hits, p.Plan.Reads})
		}
	}
	return r, nil
}
func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	r, err := run(ctx)
	if err != nil {
		var server *pgconn.PgError
		code := "none"
		if errors.As(err, &server) {
			code = server.Code
		}
		fmt.Fprintf(os.Stderr, "Read-only SQL profiling failed (stage=%s, type=%T, sqlstate=%s); data withheld\n", r.stage, err, code)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(r); err != nil {
		os.Exit(1)
	}
}
