# 37m: Interview Run promotion

Issue #434. Interview Run emits public frames, while Submit emits private frames. Completion promotion now copies private frames and updates private results only for Submit. Run still uses the same fenced verification, teardown, result promotion and receipt path.

On isolated PostgreSQL and the real Docker Python sandbox, an admitted interview Submit completed through the independent HTTP verifier and authorized results, including candidate concealment and explicit reveal. A later UTF-16 Run yielded and resumed from checkpoints across multiple verified attempts, completed with public results and no private frames, updated the latest execution ID, and retained the previous Submit's private feedback and identity. The existing result suite passed 26/26. API typecheck and scoped lint passed.

The hosted remote validation command now uses Vitest 5's explicit JSON-to-stdout reporter and checks the one exact selected test, independent of unrelated skipped test counts. Its report stays in process memory; raw runner output and provider errors are suppressed. Redaction and selection unit tests passed 3/3, and the actual Vitest/Docker subprocess produced valid stdout with no JSON report file. Hosted validation was not run.
