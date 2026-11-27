CREATE TABLE public.company_question_snapshots (
  revision text PRIMARY KEY CHECK (revision ~ '^[0-9a-f]{40}$'),
  source_url text NOT NULL,
  snapshot_date date NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX company_question_snapshots_latest
  ON public.company_question_snapshots (snapshot_date DESC, revision DESC);

CREATE TABLE public.company_question_observations (
  snapshot_revision text NOT NULL REFERENCES public.company_question_snapshots(revision) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  leetcode_id integer NOT NULL CHECK (leetcode_id > 0),
  window_rank smallint NOT NULL CHECK (window_rank BETWEEN 1 AND 5),
  frequency double precision NOT NULL CHECK (frequency BETWEEN 0 AND 100),
  PRIMARY KEY (snapshot_revision, company_id, leetcode_id, window_rank)
);

CREATE INDEX company_question_observations_problem
  ON public.company_question_observations (snapshot_revision, leetcode_id, company_id);
