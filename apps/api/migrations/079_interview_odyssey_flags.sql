ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants_feature_check;
ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants_feature_check
 CHECK(feature IN ('internal','matches.host_guests','intelligence.hosted','experimental','interviews.host','problems.odyssey'));
