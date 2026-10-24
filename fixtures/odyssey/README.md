# Odyssey fixture

`balance-ledger.json` is an original, complete `QuestionContent` authoring payload. Create an administrator draft with `{ "content": <payload> }`, then publish its returned revision through the existing question editor API. It is separate from the six competitive-match fixtures.

Only initial starter code is provided. Later levels declare new methods; candidates add them without replacing earlier source. A Submit runs the private suites from every unlocked level. An accepted cumulative result unlocks the next level. Run executes cumulative public examples; custom sequences can replace that public Run suite.

A sequence case has empty top-level `args` and ordered `calls`, each naming an authored method with typed arguments and an optional expected result. Hidden calls require expectations. `void` methods expect JSON `null`. Expected values stay outside contestant sandboxes. Each case gets a fresh zero-argument `Solution` instance; its calls share that instance. OCaml uses `Solution` module functions and fresh module state per case; zero-argument methods take `unit`.

Limits: eight levels, sixteen newly introduced methods per level, twenty examples/private cases per level, one hundred calls per case. Existing codec types apply, plus sequence-only `void` returns. Methods cannot be redefined across levels. Constructor arguments are unsupported. Execution limits and quotas use the existing judging pipeline.

Published versions retain complete private content. Public problem reads reveal level one; the authorized workspace progress endpoint returns only unlocked levels. Generic editorials are withheld for Odyssey to avoid future-level spoilers. Solo progress belongs to its workspace; interview progress belongs to its document epoch, so replacing a question cannot inherit a previous question's unlock.

Sandbox validation: build runner Dockerfiles with tags `quorem-{python,java,typescript,ocaml}:odyssey-test`, then run `QUOREM_TEST_ODYSSEY_DOCKER=1 go test ./apps/runner/internal/engine -run Odyssey`. These tags leave normal local runner images untouched.
