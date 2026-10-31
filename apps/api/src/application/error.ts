/** @file error.ts @description Expected application failures. @module api */
export type ApplicationStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 502 | 503 | 504;

export class ApplicationError extends Error {
  readonly code: string;
  readonly status: ApplicationStatus;
  constructor(code: string, message: string, status: ApplicationStatus) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
