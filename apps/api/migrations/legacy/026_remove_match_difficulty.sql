DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM matches WHERE difficulty IS DISTINCT FROM difficulties[1]) THEN
  RAISE EXCEPTION 'Match difficulty differs from its difficulty list';
 END IF;
END $$;

ALTER TABLE matches DROP COLUMN difficulty;
ALTER TABLE matches ADD CONSTRAINT matches_difficulties_check CHECK (
 cardinality(difficulties) BETWEEN 1 AND 3 AND
 difficulties <@ ARRAY['easy','medium','hard']::text[] AND array_position(difficulties,NULL) IS NULL
);
