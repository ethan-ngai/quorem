/** @file verdictPresentation.ts @description Shared symbols for every execution verdict. @module editor */
import type { PublicCaseResult } from "@quorem/contracts";
import type { ComponentProps } from "react";
import type { Icon } from "../../../ui/Icon";

const icons = {
  accepted: "submit",
  executed: "play",
  wrong_answer: "wrong-answer",
  syntax_error: "syntax-error",
  runtime_error: "runtime-error",
  time_limit: "time",
  memory_limit: "memory",
  output_limit: "output-limit",
  invalid_output: "invalid-output",
} as const satisfies Record<PublicCaseResult["status"], ComponentProps<typeof Icon>["name"]>;

/** @returns A verdict-specific symbol, including non-case execution states. */
export function verdictIcon(status?: string): ComponentProps<typeof Icon>["name"] {
  return status && Object.hasOwn(icons, status) ? icons[status as keyof typeof icons] : "close";
}
