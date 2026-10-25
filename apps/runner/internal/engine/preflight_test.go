package engine

import (
	"context"
	"testing"
	"time"
)

func TestDockerDeploymentPreflight(t *testing.T) {
	dockerTests(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := (&Docker{Image: "quorem-python:local"}).VerifySandbox(ctx); err != nil {
		t.Fatal(err)
	}
}
