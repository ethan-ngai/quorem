-- A manifest is bounded by PostgreSQL's integer ordinal, not the checkpoint batch size.
ALTER TABLE runner_job_inputs DROP CONSTRAINT runner_job_inputs_case_count_check, DROP CONSTRAINT runner_job_inputs_sample_count_check, DROP CONSTRAINT runner_job_inputs_check;
ALTER TABLE runner_job_inputs ADD CONSTRAINT runner_job_inputs_case_count_check CHECK (case_count >= 0), ADD CONSTRAINT runner_job_inputs_sample_count_check CHECK (sample_count >= 0), ADD CONSTRAINT runner_job_inputs_check CHECK (case_count::bigint + CASE WHEN submit_cases_are_samples THEN 0 ELSE sample_count END <= 2147483647);
ALTER TABLE runner_job_input_cases DROP CONSTRAINT runner_job_input_cases_ordinal_check, ADD CONSTRAINT runner_job_input_cases_ordinal_check CHECK (ordinal >= 0 AND ordinal < 2147483647);
ALTER TABLE execution_checkpoints DROP CONSTRAINT execution_checkpoints_next_ordinal_check, DROP CONSTRAINT execution_checkpoints_definite_failures_check, ADD CONSTRAINT execution_checkpoints_next_ordinal_check CHECK (next_ordinal >= 0), ADD CONSTRAINT execution_checkpoints_definite_failures_check CHECK (definite_failures >= 0);
ALTER TABLE execution_checkpoint_cases DROP CONSTRAINT execution_checkpoint_cases_ordinal_check, ADD CONSTRAINT execution_checkpoint_cases_ordinal_check CHECK (ordinal >= 0 AND ordinal < 2147483647);
ALTER TABLE execution_completion_frames DROP CONSTRAINT execution_completion_frames_ordinal_check, ADD CONSTRAINT execution_completion_frames_ordinal_check CHECK (ordinal >= 0 AND ordinal < 2147483647);
ALTER TABLE execution_completion_field_chunks DROP CONSTRAINT execution_completion_field_chunks_ordinal_check, ADD CONSTRAINT execution_completion_field_chunks_ordinal_check CHECK (ordinal >= 0 AND ordinal < 2147483647);
ALTER TABLE submission_public_result_cases DROP CONSTRAINT submission_public_result_cases_ordinal_check, ADD CONSTRAINT submission_public_result_cases_ordinal_check CHECK (ordinal >= 0 AND ordinal < 2147483647);
-- Ordered rolling digest: fixed 32-byte state even for very large legacy suites.
CREATE FUNCTION quorem_suite_digest(target_job uuid) RETURNS bytea LANGUAGE plpgsql STABLE AS $$
DECLARE state bytea := decode('d4449379235da810eea3292dffe8855373685d5d58e5dcc8070ed931bddae7c8','hex'); item record;
BEGIN
 FOR item IN SELECT ordinal,channel,blob_hash FROM runner_job_input_cases WHERE job_id=target_job ORDER BY ordinal LOOP
  state := sha256(state || int4send(item.ordinal) || convert_to(item.channel,'UTF8') || decode('00','hex') || item.blob_hash);
 END LOOP;
 RETURN state;
END $$;
