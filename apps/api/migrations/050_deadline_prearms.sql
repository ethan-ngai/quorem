-- A receipt fences activation against abandonment while a coordinator is prearmed.
CREATE TABLE deadline_prearms (
  id uuid PRIMARY KEY,
  shard integer NOT NULL CHECK (shard >= 0 AND shard < 256),
  expires_at timestamptz NOT NULL,
  committed_at timestamptz
);
CREATE INDEX deadline_prearms_shard ON deadline_prearms (shard, expires_at, id);
