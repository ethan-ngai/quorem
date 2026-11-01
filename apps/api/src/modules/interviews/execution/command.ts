/** @file command.ts @description Interview execution admission request. @module interviews */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import { parseWorkspaceCommand } from "../../judging/admission/command.ts";
export type InterviewExecutionCommand = {
  kind: "run" | "submit";
  level: number;
  questionEpoch: string;
  documentEpoch: string;
  sourceHash: string;
  customCases: string[] | null;
  raw: string;
};
const invalid = () => new ApplicationError("invalid_input", "Invalid execution command", 400);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function parseInterviewExecution(
  raw: string,
  key: string,
): Promise<InterviewExecutionCommand> {
  let c: { [key: string]: JsonValue };
  try {
    const value = parseLosslessJson(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
      throw invalid();
    c = value;
    if (
      Object.keys(c).some(
        (k) =>
          ![
            "kind",
            "level",
            "customCases",
            "questionEpoch",
            "documentEpoch",
            "sourceHash",
          ].includes(k),
      )
    )
      throw invalid();
  } catch {
    throw invalid();
  }
  if (
    (c.kind !== "run" && c.kind !== "submit") ||
    !(c.level instanceof JsonNumber) ||
    !/^[1-9]\d*$/.test(c.level.lexeme) ||
    !Number.isSafeInteger(Number(c.level.lexeme)) ||
    typeof c.questionEpoch !== "string" ||
    !uuid.test(c.questionEpoch) ||
    typeof c.documentEpoch !== "string" ||
    !uuid.test(c.documentEpoch) ||
    typeof c.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(c.sourceHash)
  )
    throw invalid();
  const workspace = await parseWorkspaceCommand(
    stringifyLosslessJson({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      kind: c.kind,
      source: "",
      ...(c.customCases !== undefined ? { customCases: c.customCases } : {}),
    }),
    key,
  );
  return {
    kind: c.kind,
    level: Number(c.level.lexeme),
    questionEpoch: c.questionEpoch,
    documentEpoch: c.documentEpoch,
    sourceHash: c.sourceHash,
    customCases: workspace.customCases,
    raw,
  };
}
