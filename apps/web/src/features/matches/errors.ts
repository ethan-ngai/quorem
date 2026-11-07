/** @file errors.ts @description Definitive command rejection. @module matches */
import { UserFacingError } from "../../ui/errors";
export class RejectedMatchCommand extends UserFacingError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
