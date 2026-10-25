ALTER TABLE interviews ADD COLUMN question_epoch uuid;
UPDATE interviews SET question_epoch=document_epoch;
ALTER TABLE interviews ALTER COLUMN question_epoch SET NOT NULL;
ALTER TABLE interviews ADD COLUMN interviewer_invite_token text;
ALTER TABLE interviews ADD COLUMN interviewer_invite_hash text;
UPDATE interviews SET interviewer_invite_token=rtrim(translate(encode(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()),'base64'),'+/','-_'),'=');
UPDATE interviews SET interviewer_invite_hash=encode(sha256(convert_to(interviewer_invite_token,'UTF8')),'hex');
ALTER TABLE interviews ALTER COLUMN interviewer_invite_token SET NOT NULL;
ALTER TABLE interviews ALTER COLUMN interviewer_invite_hash SET NOT NULL;
CREATE UNIQUE INDEX interview_interviewer_invite ON interviews(interviewer_invite_hash);
CREATE TABLE interview_language_drafts (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 question_epoch uuid NOT NULL, language text NOT NULL, source text NOT NULL,
 PRIMARY KEY(session_id,question_epoch,language)
);
CREATE TABLE interview_case_visibility (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 question_epoch uuid NOT NULL, case_id text NOT NULL,
 PRIMARY KEY(session_id,question_epoch,case_id)
);
ALTER TABLE interview_execution ADD COLUMN question_epoch uuid;
UPDATE interview_execution SET question_epoch=document_epoch;
ALTER TABLE interview_execution ALTER COLUMN question_epoch SET NOT NULL;
ALTER TABLE interview_execution ADD COLUMN private_results jsonb;
