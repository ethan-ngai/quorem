ALTER TABLE matches ADD COLUMN draw_offer_id uuid;

UPDATE matches
SET draw_offer_id = gen_random_uuid()
WHERE state = 'active' AND draw_offer_owner_id IS NOT NULL;
