-- Membership notifications and match completion locate reservations by match.
CREATE INDEX match_reservations_match ON match_reservations (match_id, owner_id);
