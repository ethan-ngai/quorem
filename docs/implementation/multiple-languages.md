# Multiple-language judging

Four local runtimes: Python 3.12, Java 21.0.9, TypeScript 5.9.3 / Node 22.21.1, OCaml 4.13.1. Public language artifacts expose starter code and explicit runtime/harness revisions. Private references remain in normalized `problem_languages`; authored editorials are separate.

Admission resolves language through the owner's workspace and snapshots runtime/harness revisions in the queue. Unsupported languages and mismatched revision pairs fail closed. Practice drafts/history remain scoped by language-specific workspace and managed account ID. Additional grammars load when selected; remote intelligence remains Python-only.

Each case compiles and executes in a fresh, unprivileged Docker sandbox, with network disabled, read-only root, bounded temporary storage, CPU, memory, processes and output. Compiler phase: at most 10 seconds per case, 60 seconds cumulative per submission. Exhaustion returns a contestant time limit with existing passed counts retained. Syntax failure avoids redundant compilation. Solution execution retains the problem wall-time budget. Worker infrastructure deadline: 120 seconds.

Local validation: all six fixtures accepted across Java/TypeScript/OCaml (360 hidden cases), intentionally incorrect implementations rejected for each fixture/language; nested optional lists, Unicode scalar string behavior, linked-list/tree cycles, primitive codecs, syntax/timeout/output errors and filesystem/environment isolation. Measured 20-case submissions: roughly 15 seconds Java/TypeScript, 5 seconds OCaml on local ARM Docker. These are local observations, not service guarantees.

Production requires independent cloud sandbox/security validation and measured concurrent judge load. Base images are digest-pinned; OS/compiler package installs remain build-time package-manager resolution where recorded in Dockerfiles. Recompilation per case favors isolation over throughput; compile-once immutable artifacts remain a future optimization.
