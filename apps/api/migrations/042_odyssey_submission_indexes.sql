CREATE INDEX submission_odyssey_history ON submissions (workspace_id, admitted_at DESC, id DESC)
 WHERE state='completed' AND NOT custom_run AND odyssey_level IS NOT NULL;

CREATE INDEX submission_workspace_active ON submissions (workspace_id)
 WHERE workspace_id IS NOT NULL AND state IN ('queued','running');
