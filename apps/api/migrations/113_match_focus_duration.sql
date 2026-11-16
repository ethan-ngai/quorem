ALTER TABLE match_rule_events
  ADD COLUMN away_seconds integer,
  ADD CONSTRAINT match_rule_events_away_seconds_check
    CHECK (away_seconds IS NULL OR (away_seconds >= 0 AND kind = 'focus'));
