# 30b: Interview snapshot boundaries

Interview creation, join, lifecycle, question and monitoring mutations return `{id}` after their transaction; operation replay preserves the ID and callers obtain current authorized content separately. The interview list returns at most 50 bounded summaries with ID, title, state, host, role, problem title and member count. Browser creation and language switching fetch a current snapshot after acknowledgement; join uses the returned ID. OpenAPI and generated contracts reflect these shapes.

PostgreSQL question/document/execution/presence suites passed 3/3/3/1; their question/presence/execution workerd suites passed 1/1 each. API and web typechecks, API boundaries and generated contract check passed.

The full interview GET snapshot still needs the reauthorized, bounded streaming owner and large-example/private-case workerd verification. Runtime composition must not ship this transitional slice until that gate passes.
