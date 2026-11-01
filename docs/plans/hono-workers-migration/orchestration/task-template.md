# Agent dispatch template

[Plan index](../README.md)

Fill every field; the packet's proposed path prefixes are not sufficient to start editing.

```text
Task ID / GitHub issue / objective:
Model: gpt-6.1-terra; reasoning: medium
Exact absolute checkout:
Branch / base SHA / PR base:
Allowed files and exclusive ownership:
Predecessors / frozen contract commits:
Required plan chunks:
Old analogues and current consumers:
Command/query behavior and failure semantics:
Shared owner/primitives to reuse:
Expected deletion/refactor of duplicate paths:
Test DB/schema / service ports (unique, disposable):
Actual validation commands and acceptance evidence:
Exclusions / feature flags / migration constraints:
Return: commits, files, tests/results, limitations, next dependencies
```

Use one cohesive command/query family. If a packet is too large for a verifiable turn, split by behavior and freeze the shared contract first. Keep medium reasoning; improve the assignment/context rather than silently switching model/effort.

Agent workflow: inspect analogues/consumers -> identify shared owner -> implement slice/tests -> review duplicates/private fields/obsolete paths -> run affected consumers -> commit complete work -> handoff. No automatic mutation retry without idempotency, no raw Drizzle rows in DTOs, no provider types in domain ports.

Conflicts/contract gaps: return the exact missing signature/invariant and affected caller. Do not edit outside ownership, duplicate a helper, fabricate success or broaden scope to KV/search. The orchestrator can issue a predecessor patch while independent work continues.
