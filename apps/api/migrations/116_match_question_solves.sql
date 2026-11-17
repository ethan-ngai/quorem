CREATE TABLE match_question_solves (
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL REFERENCES question_publications(id) ON DELETE CASCADE,
  solved_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, publication_id)
);
CREATE INDEX match_question_solves_publication ON match_question_solves(publication_id);

-- Judge workers on the previous release may still be completing submissions.
CREATE FUNCTION retain_match_question_solve() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.match_question_solves(owner_id, publication_id, solved_at)
  SELECT NEW.owner_id, v.id, NEW.observed_at FROM public.question_publications v
  WHERE v.id=NEW.publication_id AND v.odyssey IS NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER match_question_solve AFTER INSERT ON question_learning_events
  FOR EACH ROW WHEN (NEW.context='match' AND NEW.accepted)
  EXECUTE FUNCTION retain_match_question_solve();

-- Recover from learning events and judged results that still exist.
INSERT INTO match_question_solves(owner_id, publication_id, solved_at)
SELECT evidence.owner_id, evidence.publication_id, min(evidence.solved_at)
FROM (
  SELECT owner_id, publication_id, observed_at AS solved_at
  FROM question_learning_events WHERE context='match' AND accepted
  UNION ALL
  SELECT s.owner_id, w.publication_id, s.updated_at
  FROM submissions s JOIN workspaces w ON w.id=s.workspace_id AND w.kind='match'
  WHERE s.match_id IS NOT NULL AND s.interview_id IS NULL AND NOT s.custom_run
    AND s.kind='submit' AND s.state='completed' AND s.result->>'verdict'='accepted'
) evidence
JOIN users u ON u.id=evidence.owner_id AND u.kind='account'
JOIN question_publications v ON v.id=evidence.publication_id AND v.odyssey IS NULL
GROUP BY evidence.owner_id, evidence.publication_id
ON CONFLICT DO NOTHING;
