# PostgreSQL problems

SQL problems use `problem.sql` with `dialect: "postgresql"` and `outputOrder: "ordered"` or `"unordered"`. They have one `postgresql` implementation. An example or hidden case supplies one table setup in `args` and the expected result:

```json
{
  "args": [
    {
      "tables": [
        { "name": "items", "columns": [{ "name": "id", "type": "integer" }], "rows": [[1], [2]] }
      ]
    }
  ],
  "expected": { "columns": ["id"], "rows": [[1], [2]] }
}
```

Supported column types: `integer`, `bigint`, `numeric`, `text`, `boolean`, `date`, `timestamp`, `timestamptz`. SQL NULL is JSON null. PostgreSQL `numeric` output uses a typed value such as `{"$numeric":"1.25"}`; comparison ignores decimal scale and preserves precision. Text is a JSON string, distinct from numeric. Bigint table values outside the signed 32-bit range use strings; result integers outside that range use `{"$bigint":"9223372036854775807"}`. Dates and timestamps are ISO strings. Result columns support booleans, integers, floating point, numeric, text, dates, and timestamps; other PostgreSQL types are rejected. Rows are compared as an ordered sequence or a multiset; duplicates and column names matter. Tables and cases are bounded by publication validation.

Each case starts a fresh PostgreSQL cluster inside the runner's network-disabled container. Setup uses a trusted superuser; the submitted query runs through a separate non-superuser role with SELECT access only. Inputs enter the sandbox; expected results stay outside. Container limits, teardown, and startup preflight apply. The SQL sandbox requires the default memory and process limits. Hosted sandbox isolation and capacity still require validation on the deployment host.

SQL Odyssey uses one evolving query and cumulative cases. Stages must share output columns and compatible non-null value types; different queries or incompatible result shapes need a future staged-source model. Private interview SQL questions use the authorized interview fixture for execution; their test cases remain private. In-interview custom SQL authoring and competitive SQL matches are not supported.
