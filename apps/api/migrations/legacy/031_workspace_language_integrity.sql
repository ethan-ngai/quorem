-- Old SQL interviews could create an unsupported, unreferenced baseline workspace.
DELETE FROM workspaces w
WHERE NOT EXISTS (SELECT 1 FROM problem_languages l WHERE l.version_id=w.problem_version_id AND l.language=w.language)
 AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.workspace_id=w.id)
 AND NOT EXISTS (SELECT 1 FROM match_participants p WHERE p.workspace_id=w.id);

ALTER TABLE workspaces DROP CONSTRAINT workspaces_problem_version_id_fkey;
ALTER TABLE workspaces ADD CONSTRAINT workspace_problem_language_fkey
 FOREIGN KEY (problem_version_id,language) REFERENCES problem_languages(version_id,language);
