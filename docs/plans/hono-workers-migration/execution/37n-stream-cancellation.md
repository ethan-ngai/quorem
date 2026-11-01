# Stream cancellation

Issue #435. Request abort now closes the downstream stream before cancelling its upstream reader. A pending pull observes termination rather than using a released reader; repeated cancellation shares one upstream cancellation. The concurrency permit remains held until upstream cancellation settles, including rejection.

Node and native workerd each pass the five focused budget tests. They cover abort during a pending read, later reads and cancellation, a delayed cancellation and permit release, an already-aborted request, and rejected upstream cancellation. API typecheck passes. These reproduce the stream lifecycle race without a database; the original browser disconnect timing has not been independently established.

A separate Node integration test starts the actual `@hono/node-server` on loopback, disconnects an HTTP client during a live response, confirms exactly one upstream cancellation, and reconnects through the same budget successfully. It is part of the Node composition Vitest configuration and requires no database.
