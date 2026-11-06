-- Social profile reads resolve canonical usernames through issuer-scoped bindings.
CREATE INDEX identity_bindings_user_issuer ON identity_bindings(user_id, issuer);
