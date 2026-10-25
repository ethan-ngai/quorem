package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestSandboxNoSwapEvidence(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 unavailable")
	}
	header := "Filename\tType\tSize\tUsed\tPriority\n"
	for _, test := range []struct {
		name, limit, memory, swaps string
		want                       bool
	}{
		{"bounded", "0", "SwapTotal: 1024 kB\n", header, true},
		{"unbounded swapless", "max", "SwapTotal: 0 kB\n", header, true},
		{"unbounded available swap", "max", "SwapTotal: 1024 kB\n", header, false},
		{"nonzero swapless", "1", "SwapTotal: 0 kB\n", header, true},
		{"nonzero available swap", "1", "SwapTotal: 1024 kB\n", header, false},
		{"invalid controller", "invalid", "SwapTotal: 0 kB\n", header, false},
		{"no swap devices", "", "SwapTotal: 0 kB\n", header, true},
		{"no swap kernel", "", "SwapTotal: 0 kB\n", "", true},
		{"unused device", "", "SwapTotal: 0 kB\n", header + "/swap file 1024 0 -2\n", false},
		{"available swap", "", "SwapTotal: 1024 kB\n", header, false},
		{"missing evidence", "", "MemTotal: 1024 kB\n", header, false},
		{"malformed evidence", "", "SwapTotal: 0\n", header, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			for name, value := range map[string]string{
				"memory.swap.max": test.limit, "meminfo": test.memory, "swaps": test.swaps,
			} {
				if value != "" {
					if err := os.WriteFile(filepath.Join(root, name), []byte(value), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			code := isolationProbe + "\nimport sys\nno_swap(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[1]))"
			output, err := exec.Command(python, "-c", code, root).CombinedOutput()
			if (err == nil) != test.want {
				t.Fatalf("accepted=%v want=%v: %s", err == nil, test.want, output)
			}
		})
	}
}

func TestDockerDeploymentPreflight(t *testing.T) {
	dockerTests(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := (&Docker{Image: "quorem-python:local"}).VerifySandbox(ctx); err != nil {
		t.Fatal(err)
	}
}
