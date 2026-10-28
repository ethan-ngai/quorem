package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type executionDrainer interface {
	Drain(context.Context, execution.ExecutionEngine, int) (worker.DrainState, bool, error)
}

func drainHandler(service executionDrainer, engine execution.ExecutionEngine, slots int, token string) http.Handler {
	active := make(chan struct{}, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /internal/drain", func(w http.ResponseWriter, r *http.Request) {
		supplied := []byte(r.Header.Get("Authorization"))
		if len(token) < 32 || subtle.ConstantTimeCompare(supplied, []byte("Bearer "+token)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if refresher, ok := service.(interface{ RefreshAdmissionGrace() }); ok {
			refresher.RefreshAdmissionGrace()
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		select {
		case active <- struct{}{}:
			defer func() { <-active }()
		default:
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(worker.DrainState{})
			return
		}
		// Leave time for bounded sandbox teardown and durable completion below the 240s HTTP limit.
		ctx, cancel := context.WithTimeout(r.Context(), 210*time.Second)
		defer cancel()
		// A new attempt needs its full execution, teardown, and completion window.
		deadline, _ := ctx.Deadline()
		ctx = worker.WithDrainClaimDeadline(ctx, deadline.Add(-execution.AttemptTimeout-execution.TeardownTimeout-execution.CompletionTimeout))
		state, complete, err := service.Drain(ctx, engine, slots)
		status := http.StatusAccepted
		if err != nil {
			status = http.StatusServiceUnavailable
		} else if complete {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(state)
	})
	return mux
}
