export interface MigrationProvenance {
  owner: string;
  repository: string;
  workflow: string;
  runId: string;
  commitSha: string;
  artifactDigest: string;
  files: Record<string, string>;
}
export function githubRequest(path: string): Promise<unknown>;
export function verifyMigrationArtifact(options: {
  runId: string;
  productNames: string[];
  authNames: string[];
  request?: (path: string) => Promise<unknown>;
}): Promise<MigrationProvenance>;
