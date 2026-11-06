-- Profile and rivalry reads start from an account's completed-match memberships.
CREATE INDEX match_participants_owner_match ON match_participants(owner_id, match_id);
