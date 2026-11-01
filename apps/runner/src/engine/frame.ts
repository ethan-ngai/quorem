/** @file frame.ts @description Decode bounded harness output after confirmed teardown. @module runner */
import { JsonNumber, parseLosslessJson, stringifyLosslessJson } from "@quorem/questions";
import { type JudgeFrame } from "@quorem/execution";
import { type CaseOutput } from "../sandbox/types.ts";
import { object } from "./request.ts";
export function harnessFrame(
  output: CaseOutput,
  language: string,
  outputLimit: number,
): JudgeFrame {
  const markers = ["python", "postgresql"].includes(language) ? 1 : 2;
  if (
    output.stdout.length < markers ||
    output.stdout.subarray(0, markers).some((value) => value !== 0)
  )
    throw new Error("Sandbox readiness missing");
  if (output.exitCode !== 0)
    return {
      status: output.exitCode === 137 ? "memory_limit" : "runtime_error",
      actual: "null",
      stdout: "",
      stderr: "",
      line: 0,
    };
  try {
    const value = object(
      parseLosslessJson(
        new TextDecoder("utf-8", { fatal: true }).decode(output.stdout.subarray(markers)),
      ),
    );
    const allowed = ["status", "actual", "stdout", "stderr", "line", "artifact", "sqlTypes"];
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new Error("unknown frame field");
    if (value.stdout !== undefined && value.stdout !== null && typeof value.stdout !== "string")
      throw new Error("invalid stdout");
    if (value.stderr !== undefined && value.stderr !== null && typeof value.stderr !== "string")
      throw new Error("invalid stderr");
    if (
      value.line !== undefined &&
      value.line !== null &&
      !(value.line instanceof JsonNumber && /^(0|[1-9][0-9]*)$/.test(value.line.lexeme))
    )
      throw new Error("invalid line");
    const status =
      typeof value.status === "string" &&
      [
        "executed",
        "syntax_error",
        "runtime_error",
        "memory_limit",
        "output_limit",
        "invalid_output",
      ].includes(value.status)
        ? value.status
        : "invalid_output";
    const stdout = typeof value.stdout === "string" ? value.stdout : "",
      stderr = typeof value.stderr === "string" ? value.stderr : "";
    const actual = value.actual === undefined ? "null" : stringifyLosslessJson(value.actual),
      artifact = value.artifact === undefined ? undefined : stringifyLosslessJson(value.artifact);
    const line =
      value.line instanceof JsonNumber && /^(0|[1-9][0-9]*)$/.test(value.line.lexeme)
        ? Number(value.line.lexeme)
        : 0;
    const types =
      value.sqlTypes === undefined
        ? undefined
        : Array.isArray(value.sqlTypes) && value.sqlTypes.every((item) => typeof item === "string")
          ? (value.sqlTypes as string[])
          : (() => {
              throw new Error("invalid types");
            })();
    const bytes = (value: string) => new TextEncoder().encode(value).length;
    if (
      bytes(stdout) > outputLimit ||
      bytes(stderr) > outputLimit ||
      bytes(actual) > outputLimit ||
      (artifact !== undefined && bytes(artifact) > 4 * 1024 * 1024)
    )
      return { status: "output_limit", actual: "null", stdout: "", stderr: "", line: 0 };
    if (!Number.isSafeInteger(line) || line < 0 || line > 2147483647)
      throw new Error("invalid line");
    return { status, actual, stdout, stderr, line, artifact, sqlTypes: types };
  } catch {
    return { status: "invalid_output", actual: "null", stdout: "", stderr: "", line: 0 };
  }
}
