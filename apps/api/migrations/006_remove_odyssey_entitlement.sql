DELETE FROM entitlement_grants WHERE feature = 'problems.odyssey';

-- Remove only the retired entitlement's historical audit entries.
ALTER TABLE access_audit DISABLE TRIGGER immutable_access_audit;
DELETE FROM access_audit WHERE action IN ('grant:problems.odyssey', 'revoke:problems.odyssey');
ALTER TABLE access_audit ENABLE TRIGGER immutable_access_audit;

ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants_feature_check;
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants_feature_check
    CHECK (feature IN ('internal', 'matches.host_guests', 'intelligence.hosted', 'experimental', 'interviews.host', 'questions.custom'));
