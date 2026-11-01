# Deadlines and retention

[Plan index](README.md)

- A `DeadlineScheduler` port requests reevaluation by aggregate identity/version and due instant. Cloudflare adapter uses sharded coordinator DO alarms; Node uses a bounded scheduler over PostgreSQL. PostgreSQL determines actual due state and outcome under locks.
- Save deadline intent with the domain transaction; prompt wake schedules/recomputes earliest due work. A crash between commit and alarm is repaired by the sweeper. Duplicate, late and stale alarms re-read the database and cannot finalize twice.
- One DO has one alarm; coordinator stores/recomputes its earliest pending deadline. Avoid one global bottleneck. Retry exhaustion requires explicit rearming plus independent sweep recovery. [Alarm semantics](https://developers.cloudflare.com/durable-objects/api/alarms/).
- Hourly retention becomes bounded scheduled maintenance, with the same deletion rules and resumable batch progress. No full-table scan per request or cold start.

Reuse dispatch claim/retry primitives from [durable work](background.md); keep deadline semantics separate. Scheduling adds no second match authority. Canonical transition functions compute decisions; repositories persist them under the database clock and row locks.
