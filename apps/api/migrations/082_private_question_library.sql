ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants_feature_check;
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants_feature_check
 CHECK(feature IN ('internal','matches.host_guests','intelligence.hosted','experimental','interviews.host','problems.odyssey','questions.custom'));
ALTER TABLE problems ADD COLUMN owner_id text REFERENCES users(id);
CREATE INDEX problems_private_owner ON problems(owner_id) WHERE owner_id IS NOT NULL;
ALTER TABLE question_drafts ADD COLUMN owner_id text REFERENCES users(id);
CREATE INDEX question_drafts_private_owner ON question_drafts(owner_id,updated_at DESC,id DESC);
