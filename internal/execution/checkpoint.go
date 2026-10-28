package execution

import "encoding/json"

// Checkpoint data is judge-private and bound to the admitted job and runtime.
type Checkpoint struct {
	NextOrdinal      int
	Artifact         json.RawMessage
	CompilationNanos int64
	Fatal            json.RawMessage
}

type CheckpointCase struct {
	Ordinal          int
	Frame            json.RawMessage
	Artifact         json.RawMessage
	CompilationNanos int64
	Fatal            json.RawMessage
}
