BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT stats_reset, xact_commit, xact_rollback FROM pg_stat_database WHERE datname = current_database();

SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_stat_statements') AS has_statements \gset
\if :has_statements
-- Use fixed labels; statement text and values must never reach Actions logs.
SELECT queryid, calls, round(total_exec_time::numeric) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms, shared_blks_read, shared_blks_hit,
       CASE
         WHEN query ILIKE '%runner_blob_rechecks%' OR query ILIKE '%runner_input_gc_state%' THEN 'input blob reclamation'
         WHEN query ILIKE '%execution_dispatch_intents%' THEN 'execution dispatch'
         WHEN query ILIKE '%outbox%' THEN 'outbox'
         WHEN query ILIKE '%deadline_prearms%' THEN 'deadline prearms'
         WHEN query ILIKE '%submissions%' THEN 'submissions'
         WHEN query ILIKE '%question_publications%' THEN 'catalog'
         WHEN query ILIKE '%quorem_auth%' THEN 'auth'
         WHEN query ILIKE '%set_config%' THEN 'transaction settings'
         ELSE 'other'
       END AS family
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND toplevel
ORDER BY total_exec_time DESC LIMIT 30;
\endif

SELECT schemaname, relname, n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan,
       pg_relation_size(relid) AS heap_bytes
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC NULLS LAST LIMIT 25;

SELECT relname, indexrelname, idx_scan, pg_relation_size(indexrelid) AS bytes
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY bytes DESC LIMIT 20;

ROLLBACK;
