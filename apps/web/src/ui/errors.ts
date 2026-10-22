/** Never render raw exceptions or service messages in product UI. */
export class UserFacingError extends Error {}

export function userFacingErrorMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError ? error.message : fallback;
}
