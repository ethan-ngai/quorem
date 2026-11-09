ALTER TABLE matches ADD COLUMN review_final_code boolean NOT NULL DEFAULT false;
ALTER TABLE matches ADD COLUMN review_winning_submission_id uuid REFERENCES submissions(id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN match_review_source text;
