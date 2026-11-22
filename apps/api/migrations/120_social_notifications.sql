CREATE TABLE friendships (
  first_owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  second_owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at timestamptz,
  PRIMARY KEY (first_owner_id, second_owner_id),
  CHECK (first_owner_id <> second_owner_id AND requester_id IN (first_owner_id, second_owner_id))
);
CREATE INDEX friendships_second_owner ON friendships(second_owner_id);

CREATE TABLE social_blocks (
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_id, blocked_owner_id),
  CHECK (owner_id <> blocked_owner_id)
);

CREATE TABLE inbox_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('friend_request', 'match_invite')),
  party_id uuid REFERENCES parties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  CHECK ((kind = 'match_invite') = (party_id IS NOT NULL))
);
CREATE INDEX inbox_notifications_owner_created ON inbox_notifications(owner_id, created_at DESC);
CREATE INDEX inbox_notifications_created ON inbox_notifications(created_at);
CREATE UNIQUE INDEX inbox_friend_request ON inbox_notifications(owner_id, sender_id) WHERE kind = 'friend_request';
CREATE UNIQUE INDEX inbox_match_invite ON inbox_notifications(owner_id, party_id) WHERE kind = 'match_invite';

CREATE TABLE notification_preferences (
  owner_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_friend_requests boolean NOT NULL,
  push_match_invites boolean NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX push_subscriptions_owner ON push_subscriptions(owner_id);

CREATE TABLE social_notification_limits (
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('friend_request', 'match_invite')),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count BETWEEN 1 AND 12),
  PRIMARY KEY (owner_id, kind)
);
