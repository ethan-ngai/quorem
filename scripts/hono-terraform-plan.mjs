/** Applied actions exclude observational drift; no-op plans may omit the changes array. */
export function plannedResourceChanges(plan) {
  if (
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    !Array.isArray(plan.resource_changes ?? []) ||
    !Array.isArray(plan.resource_drift ?? [])
  )
    throw new Error("Invalid Terraform plan");
  return plan.resource_changes ?? [];
}
