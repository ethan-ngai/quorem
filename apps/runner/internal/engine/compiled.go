package engine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

const compiledArtifactLimit = 4 << 20

type compiledArtifact struct {
	Version  int               `json:"version"`
	Language string            `json:"language"`
	Files    map[string]string `json:"files"`
}

func compilationRequest(spec worker.Spec) []byte {
	request, _ := json.Marshal(map[string]any{"operation": "compile", "source": spec.Source, "signature": spec.Problem.Signature, "methods": worker.MethodSignatures(spec.Problem)})
	return request
}

func compiledFirstCaseRequest(spec worker.Spec, c worker.Case) []byte {
	request, _ := json.Marshal(map[string]any{"operation": "compile-execute", "source": spec.Source, "signature": spec.Problem.Signature, "methods": worker.MethodSignatures(spec.Problem), "args": c.Args, "calls": compiledCalls(c)})
	return request
}

func compiledCalls(c worker.Case) []map[string]any {
	calls := make([]map[string]any, 0, len(c.Calls))
	for _, call := range c.Calls {
		calls = append(calls, map[string]any{"methodName": call.MethodName, "args": call.Args})
	}
	return calls
}

func compiledCaseRequest(spec worker.Spec, c worker.Case, artifact json.RawMessage) []byte {
	request, _ := json.Marshal(map[string]any{"operation": "execute", "artifact": artifact, "args": c.Args, "calls": compiledCalls(c)})
	return request
}

func validateCompiledArtifact(raw json.RawMessage, language string) error {
	if len(raw) == 0 || len(raw) > compiledArtifactLimit {
		return errors.New("compiled artifact size exceeded")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var artifact compiledArtifact
	if err := decoder.Decode(&artifact); err != nil {
		return errors.New("invalid compiled artifact")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("invalid compiled artifact trailing data")
	}
	if artifact.Version != 1 || artifact.Language != language || len(artifact.Files) == 0 || len(artifact.Files) > 256 {
		return errors.New("invalid compiled artifact metadata")
	}
	entrypoint := ""
	switch language {
	case "java":
		entrypoint = "Main.class"
	case "typescript":
		entrypoint = "main.js"
	case "ocaml":
		entrypoint = "main.byte"
	default:
		return errors.New("unsupported compiled artifact")
	}
	if _, ok := artifact.Files[entrypoint]; !ok {
		return errors.New("compiled artifact entrypoint missing")
	}
	total := 0
	for name, value := range artifact.Files {
		if len(name) == 0 || len(name) > 255 || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\\x00") {
			return errors.New("invalid compiled artifact path")
		}
		if language == "java" {
			if !strings.HasSuffix(name, ".class") || len(name) <= 6 {
				return errors.New("invalid Java artifact")
			}
		} else if name != entrypoint {
			return errors.New("unexpected compiled artifact")
		}
		data, err := base64.StdEncoding.Strict().DecodeString(value)
		if err != nil {
			return errors.New("invalid compiled artifact encoding")
		}
		total += len(data)
		if total > compiledArtifactLimit {
			return errors.New("compiled artifact size exceeded")
		}
	}
	return nil
}

func (d *Docker) compileSubmission(ctx context.Context, j execution.Job, spec worker.Spec) (json.RawMessage, frame, error) {
	budget := d.compilationLimit
	if budget <= 0 {
		budget = compilationBudget
	}
	f, err := d.runRequest(ctx, j, -1, compilationRequest(spec), compiledArtifactLimit, budget)
	if err != nil || f.Status != "executed" {
		return nil, f, err
	}
	runtime, ok := execution.RuntimeForRevision(j.RuntimeRevision, j.HarnessRevision)
	if !ok {
		return nil, f, errors.New("unsupported compilation revision")
	}
	if err = validateCompiledArtifact(f.Actual, runtime.Language); err != nil {
		return nil, f, err
	}
	return f.Actual, f, nil
}
