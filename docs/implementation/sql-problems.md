# SQL questions

SQL questions declare input tables and result columns once in `problem.sql`. Every example and hidden case supplies rows for each named table and result rows in that schema's column order:

```json
{
  "sql": {
    "dialect": "postgresql",
    "outputOrder": "unordered",
    "tables": [{ "name": "items", "columns": [{ "name": "id", "type": "integer" }] }],
    "output": [{ "name": "id", "type": "integer" }]
  },
  "example": {
    "args": [{ "tables": [{ "name": "items", "rows": [[1], [2]] }] }],
    "expected": { "rows": [[1], [2]] }
  }
}
```

Authors provide the same schema for all stages and cases. Publication checks table names, row widths, value types and expected output types against it. New schema questions use the `quorem-postgresql-v2` harness. Published legacy SQL versions remain runnable; authors must supply the schema and convert cases to rows-only when publishing a new version. Publication does not execute the reference solution.

The schema uses dialect-independent pseudotypes; the PostgreSQL runner maps them to its SQL types. Supported input pseudotypes: `integer`, `bigint`, `numeric`, `text`, `boolean`, `date`, `timestamp`, `timestamptz`. SQL NULL is JSON null. PostgreSQL `numeric` output uses a typed value such as `{"$numeric":"1.25"}`; comparison ignores decimal scale and preserves precision. Text is a JSON string, distinct from numeric. Bigint table values outside the signed 32-bit range use strings; result integers outside that range use `{"$bigint":"9223372036854775807"}`. Dates and timestamps are ISO strings. Output pseudotypes also support `real` and `double precision`. The judge checks the actual result column types and names, including when there are no rows; other PostgreSQL output types are rejected. Rows are compared as an ordered sequence or a multiset; duplicates and column names matter. Tables and cases are bounded by publication validation.

Each case starts a fresh PostgreSQL cluster inside the runner's network-disabled container. Setup uses a trusted superuser; the submitted query runs through a separate non-superuser role with SELECT access only. Inputs enter the sandbox; expected results stay outside. Container limits, teardown, and startup preflight apply. Visible cases include a bounded PostgreSQL error message and source line when available; hidden-case diagnostics stay private. The SQL sandbox requires the default memory and process limits. Hosted sandbox isolation and capacity still require validation on the deployment host.

SQL Odyssey uses one evolving query and cumulative cases. Stages must share output columns and compatible non-null value types; different queries or incompatible result shapes need a future staged-source model. Private interview SQL questions use the authorized interview fixture for execution; their test cases remain private. In-interview custom SQL authoring and competitive SQL matches are not supported.
