/** @file fingerprint.ts @description Go-compatible interview admission identity. @module interviews */
import { parseLosslessJson, type JsonValue } from "@quorem/questions";
import { interviewCommandFingerprint } from "../../../../modules/interviews/question/fingerprint.ts";
import type { InterviewExecutionCommand } from "../../../../modules/interviews/execution/command.ts";
import { markRawExecutionCases } from "../../problems/case-literals.ts";
type Obj = { [key: string]: JsonValue };
const object = (value: JsonValue): Obj => value as Obj;
function testCase(value: JsonValue) {
  const c = object(value);
  return {
    ...(Array.isArray(c.calls) && c.calls.length
      ? {
          calls: c.calls.map((v) => {
            const a = object(v);
            return {
              methodName: a.methodName ?? "",
              args: a.args ?? null,
              ...(a.expected !== undefined ? { expected: a.expected } : {}),
            };
          }),
        }
      : {}),
    args: c.args ?? null,
    ...(c.expected !== undefined ? { expected: c.expected } : {}),
  };
}
export async function interviewExecutionFingerprint(
  id: string,
  command: InterviewExecutionCommand,
): Promise<string> {
  const raw = object(parseLosslessJson(command.raw)),
    marks = markRawExecutionCases(command.raw, raw);
  return interviewCommandFingerprint(
    `${id}:submission`,
    {
      kind: command.kind,
      level: command.level,
      ...(command.customCases
        ? { customCases: (raw.customCases as JsonValue[]).map(testCase) }
        : {}),
      questionEpoch: command.questionEpoch,
      documentEpoch: command.documentEpoch,
      sourceHash: command.sourceHash,
    },
    marks,
  );
}
