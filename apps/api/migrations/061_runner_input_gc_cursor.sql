-- The cursor advances only with its bounded collection transaction.
CREATE TABLE runner_input_gc_state (
 id integer PRIMARY KEY CHECK (id = 1),
 cursor bytea CHECK (cursor IS NULL OR octet_length(cursor) = 32)
);
INSERT INTO runner_input_gc_state(id) VALUES (1);
