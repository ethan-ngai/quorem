/** @file validation-error.ts @description Paths for authored content errors. @module questions */
export class QuestionFieldError extends Error {
  readonly path: string;

  constructor(path: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.path = path;
  }
}

/** Attach an authoring field path to a codec error. */
export function validateField(path: string, validate: () => void): void {
  try {
    validate();
  } catch (error) {
    if (error instanceof QuestionFieldError) throw error;
    throw new QuestionFieldError(
      path,
      error instanceof Error ? error.message : "Invalid question content",
      { cause: error },
    );
  }
}
