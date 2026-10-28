/** Never render raw exceptions or service messages in product UI. */
export class UserFacingError extends Error {
  useFallback = false;
}

export function userFacingErrorMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError && !error.useFallback ? error.message : fallback;
}
