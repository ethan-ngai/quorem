ALTER TABLE matches ADD COLUMN draw_offer_owner_id text REFERENCES users(id) ON DELETE SET NULL;
