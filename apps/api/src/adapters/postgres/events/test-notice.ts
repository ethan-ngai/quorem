/** @file test-notice.ts @description Seeds an isolated interview notice for PostgreSQL tests. @module events */
export const insertTestNotice = `WITH owner AS (
  INSERT INTO users(id,display_name) VALUES ($2,'Notice fixture') RETURNING id
), room AS (
  INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token)
  SELECT gen_random_uuid(),id,'Fixture','{}'::jsonb,'python','',gen_random_uuid(),gen_random_uuid(),gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text FROM owner
  RETURNING id
)
INSERT INTO interview_outbox(id,session_id,event_type,occurred_at,published_at)
SELECT $1,id,'fixture.updated',clock_timestamp()-($3 * interval '1 day'),
  CASE WHEN $4::boolean THEN clock_timestamp() END FROM room`;
