package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
)

func main() {
	raw := os.Getenv("QUOREM_RUNNER_TEST_DATABASE_URL")
	u, err := url.Parse(raw)
	if err != nil || u.Port() != "55464" || u.Path != "/quorem_hono_runner_test" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
		panic("disposable runner database required")
	}
	store, err := postgres.OpenRunner(context.Background(), raw)
	if err != nil {
		panic(err)
	}
	defer store.Pool.Close()
	job, err := store.ClaimAfterTeardown(context.Background(), true, "", "scope-go")
	if err != nil {
		panic(err)
	}
	data, err := json.Marshal(job)
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
