#!/bin/sh
# Read-only legacy export. Write private backups outside the repository.
set -eu
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <legacy-database-url> <private-output.json>" >&2
  exit 1
fi
umask 077
psql "$1" -XAt -v ON_ERROR_STOP=1 -c '
SELECT json_build_object(
  '\''workspaces'\'', COALESCE((SELECT json_agg(row_to_json(d)) FROM (
    SELECT owner_id AS "identity", id::text AS "workspaceId", kind,
      problem_version_id::text AS "problemVersionId", source
    FROM workspaces ORDER BY updated_at
  ) d), '\''[]'\''::json),
  '\''history'\'', COALESCE((SELECT json_agg(row_to_json(d)) FROM (
    SELECT w.owner_id AS "identity", d.workspace_id::text AS "workspaceId",
      d.revision, d.source, d.saved_at AS "savedAt"
    FROM draft_versions d JOIN workspaces w ON w.id=d.workspace_id
    ORDER BY d.saved_at
  ) d), '\''[]'\''::json)
)' > "$2"
