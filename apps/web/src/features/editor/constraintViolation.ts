/** Keep the failing rule and inputs attached while diagnostics travel through authoring. */
export class ConstraintViolation extends Error {
  constructor(
    readonly constraintIndex: number,
    readonly parameters: readonly string[],
    message: string,
  ) {
    super(`Constraint ${constraintIndex + 1}: ${message}`);
    this.name = "ConstraintViolation";
  }
}
