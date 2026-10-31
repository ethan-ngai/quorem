/** @file policy.ts @description Provider-free interview membership rules. @module interviews */
import { ApplicationError } from "../../../application/error.ts";
import type { InterviewRole } from "./model.ts";
export function requireInterviewer(role: InterviewRole): void {
  if (role !== "interviewer")
    throw new ApplicationError("forbidden", "Interviewer access required", 403);
}
export function guestName(input: string): string {
  const name = input.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 40 || /[\r\n\t]/.test(name))
    throw new ApplicationError("invalid_input", "Choose a name between 1 and 40 characters", 400);
  return name;
}
export function validTitle(input: string): string {
  const title = input.trim();
  if (!title || Array.from(title).length > 120)
    throw new ApplicationError(
      "invalid_input",
      "Choose an interview title up to 120 characters",
      400,
    );
  return title;
}
