ALTER TABLE quorem_auth."user" ADD COLUMN profile_color integer NOT NULL DEFAULT (floor(random() * 24)::integer + 1) CHECK (profile_color BETWEEN 1 AND 24);
ALTER TABLE quorem_auth."user" ADD COLUMN profile_color_revision bigint NOT NULL DEFAULT (floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
