package gateway

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// EngineFactory separates session policy from the local Docker/cloud worker adapter.
type EngineFactory interface {
	Start(context.Context, string) (Engine, error)
}
type Engine interface {
	Input() io.WriteCloser
	Output() io.Reader
	Close() error
}
type DockerFactory struct {
	Address string
	Image   string
}
type dockerEngine struct {
	name    string
	input   io.WriteCloser
	output  io.Reader
	process *exec.Cmd
	mu      sync.Mutex
	removed bool
}

func (e *dockerEngine) Input() io.WriteCloser { return e.input }
func (e *dockerEngine) Output() io.Reader     { return e.output }
func dockerCommand(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil && !(len(args) > 0 && args[0] == "rm" && strings.Contains(string(output), "No such container")) {
		return errors.New("container operation failed")
	}
	return nil
}
func (e *dockerEngine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.removed {
		return nil
	}
	if err := dockerCommand("rm", "-f", e.name); err != nil {
		return err
	}
	if e.input != nil {
		_ = e.input.Close()
	}
	if e.process != nil && e.process.Process != nil {
		_ = e.process.Process.Kill()
		_ = e.process.Wait()
	}
	e.removed = true
	return nil
}
func (f DockerFactory) Start(ctx context.Context, owner string) (Engine, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	engine := &dockerEngine{name: "quorem-language-" + hex.EncodeToString(id[:])}
	image := f.Image
	if image == "" {
		image = "quorem-language:local"
	}
	// Finish create before cleanup, even if the editor disconnects during startup.
	err := dockerCommand("create", "-i", "--name", engine.name, "--label", "quorem.language.owner="+owner, "--label", "quorem.language.address="+f.Address,
		"--network", "none", "--read-only", "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "32", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m", "--user", "65534:65534", "--env", "NODE_OPTIONS=--max-old-space-size=384", image)
	if err != nil {
		return engine, err
	}
	if err = ctx.Err(); err != nil {
		return engine, err
	}
	command := exec.CommandContext(ctx, "docker", "start", "-a", "-i", engine.name)
	input, err := command.StdinPipe()
	if err != nil {
		return engine, err
	}
	engine.input = input
	output, err := command.StdoutPipe()
	if err != nil {
		return engine, err
	}
	engine.output = output
	engine.process = command
	if err = command.Start(); err != nil {
		return engine, err
	}
	// Close removes the container and reaps its attached Docker process.
	return engine, nil
}
