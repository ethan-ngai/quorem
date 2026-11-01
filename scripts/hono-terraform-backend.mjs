/** @file hono-terraform-backend.mjs @description Explicit locked deployment state selection. @module deployment */
export function terraformBackendArgs(env, directory, key = directory) {
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !/^[a-z0-9-]+$/.test(directory) ||
    !/^[a-z0-9-]+$/.test(key) ||
    !env.TF_STATE_BUCKET
  )
    throw new Error("Invalid Terraform backend identity");
  return [
    `-chdir=infra/terraform/${directory}`,
    "init",
    "-input=false",
    `-backend-config=bucket=${env.TF_STATE_BUCKET}`,
    `-backend-config=key=${key}/terraform.tfstate`,
    "-backend-config=region=auto",
    `-backend-config=endpoints={s3=\"https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com\"}`,
    ...[
      "skip_credentials_validation",
      "skip_region_validation",
      "skip_requesting_account_id",
      "skip_metadata_api_check",
      "skip_s3_checksum",
      "use_lockfile",
    ].map((name) => `-backend-config=${name}=true`),
  ];
}
