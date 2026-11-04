-- Finished jobs may keep their pinned input hashes through a publication edit.
ALTER TABLE runner_job_inputs ALTER CONSTRAINT runner_job_inputs_version_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
