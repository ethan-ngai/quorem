package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"testing"
	"time"
)

func TestDockerJavaColdCompilerRespectsPIDLimitOnLargeHost(t *testing.T) {
	fixture := dockerTests(t)[0]
	fixture.Problem.Signature.MethodName = "solve"
	fixture.Problem.Signature.Parameters = fixture.Problem.Signature.Parameters[:0]
	fixture.Problem.Signature.ReturnType = "int"
	source := `class Solution { public int solve() throws Exception {
  if (!java.nio.file.Files.readString(java.nio.file.Path.of("/sys/fs/cgroup/pids.max")).trim().equals("16")) throw new Exception("incorrect PID cap");
  return Runtime.getRuntime().availableProcessors();
 } }`
	request, err := json.Marshal(map[string]any{"source": source, "signature": fixture.Problem.Signature, "args": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	name := "quorem-java-threads-" + time.Now().Format("150405.000000000")
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err := removeContainer(cleanup, name); err != nil {
			t.Error(err)
		}
	}()
	// Simulate many visible host cores; explicit compiler/runtime flags must override JVM defaults.
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "-i", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "268435456", "--memory-swap", "268435456", "--pids-limit", "16", "--cpus", "1", "--user", "65534:65534", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16777216", "--env", "JAVA_TOOL_OPTIONS=-XX:-UseContainerSupport -XX:ActiveProcessorCount=64", "quorem-java:local")
	cmd.Stdin = bytes.NewReader(request)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("cold Java sandbox failed: %v %s", err, stderr.Bytes())
	}
	if !bytes.HasPrefix(output, []byte{0, 0}) {
		t.Fatalf("compiler did not complete both readiness phases: %s %s", output, stderr.Bytes())
	}
	var result frame
	if err = json.Unmarshal(output[2:], &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "executed" || string(result.Actual) != "1" {
		t.Fatalf("JVM thread bounds failed: %+v", result)
	}
}
