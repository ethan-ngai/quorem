ALTER TABLE execution_jobs
  ADD COLUMN case_cpu_ms integer CHECK (case_cpu_ms BETWEEN 1 AND 10000);
