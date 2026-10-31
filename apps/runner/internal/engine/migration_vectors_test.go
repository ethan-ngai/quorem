package engine

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func TestMigrationFrameVectors(t *testing.T) {
	exit := testCaseFrame(3, []byte{0, 0, 0, 7})
	teardown := testCaseFrame(4, nil)
	join := func(parts ...[]byte) []byte { return bytes.Join(parts, nil) }
	cases := []struct {
		name string
		data []byte
	}{
		{"valid", join(testCaseFrame(1, []byte("out")), testCaseFrame(2, []byte("err")), exit, teardown)},
		{"empty", nil}, {"short-header", []byte{1, 0, 0}},
		{"short-output", []byte{1, 0, 0, 0, 0, 0, 0, 3, 'x'}},
		{"short-exit", []byte{3, 0, 0, 0, 0, 0, 0, 4, 0}},
		{"missing-teardown", exit}, {"short-after-exit", join(exit, []byte{4, 0})},
		{"reserved-byte", []byte{1, 1, 0, 0, 0, 0, 0, 0}}, {"oversize", []byte{1, 0, 0, 0, 0, 1, 0, 1}},
		{"unknown-channel", testCaseFrame(5, nil)}, {"teardown-before-exit", teardown},
		{"output-after-exit", join(exit, testCaseFrame(1, []byte("x")), teardown)},
		{"duplicate-exit", join(exit, exit, teardown)}, {"trailing-byte", join(exit, teardown, []byte{1})},
		{"empty-output", join(testCaseFrame(1, nil), exit, teardown)},
	}
	type vector struct {
		Name          string `json:"name"`
		InputHex      string `json:"inputHex"`
		StdoutHex     string `json:"stdoutHex"`
		StderrHex     string `json:"stderrHex"`
		ExitCode      int    `json:"exitCode"`
		ExitCallbacks int    `json:"exitCallbacks"`
		Error         string `json:"error,omitempty"`
	}
	var vectors []vector
	for _, c := range cases {
		var stdout, stderr bytes.Buffer
		calls := 0
		code, err := copyCaseFrames(bytes.NewReader(c.data), &stdout, &stderr, func() { calls++ })
		v := vector{c.name, hex.EncodeToString(c.data), hex.EncodeToString(stdout.Bytes()), hex.EncodeToString(stderr.Bytes()), code, calls, ""}
		if err != nil {
			v.Error = err.Error()
		}
		vectors = append(vectors, v)
	}
	if vectors[0].Error != "" || vectors[0].ExitCode != 7 || vectors[0].ExitCallbacks != 1 || vectors[5].Error == "" || vectors[5].ExitCallbacks != 1 || vectors[3].StdoutHex != "78" {
		t.Fatal("unexpected frame behavior")
	}
	data, err := json.MarshalIndent(vectors, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := "../../../../fixtures/migration/private/frame-oracle.json"
	if os.Getenv("QUOREM_UPDATE_MIGRATION_VECTORS") == "1" {
		if err = os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, want) {
		t.Fatal("frame vectors differ")
	}
}
