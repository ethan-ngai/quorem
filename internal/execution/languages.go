package execution

// Runtime binds queue snapshots to a supported compiler and harness contract.
type Runtime struct {
	Language string
	Revision string
	Harness  string
	Image    string
}

var runtimes = []Runtime{
	{"python", RuntimeRevision, HarnessRevision, "quorem-python:local"},
	{"java", "java-21.0.9-v1", "quorem-java-v1", "quorem-java:local"},
	{"typescript", "typescript-5.9.3-node-22.21.1-v1", "quorem-typescript-v1", "quorem-typescript:local"},
	{"ocaml", "ocaml-4.13.1-v1", "quorem-ocaml-v1", "quorem-ocaml:local"},
}

func LanguageRuntime(language string) (Runtime, bool) {
	for _, runtime := range runtimes {
		if runtime.Language == language {
			return runtime, true
		}
	}
	return Runtime{}, false
}

func RuntimeForRevision(revision, harness string) (Runtime, bool) {
	for _, runtime := range runtimes {
		if runtime.Revision == revision && runtime.Harness == harness {
			return runtime, true
		}
	}
	return Runtime{}, false
}
