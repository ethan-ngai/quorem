/** @file prepare.ts @description Canonical published interview question construction. @module interviews */
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { InterviewCreate } from "../../../../modules/interviews/lifecycle/model.ts";
import type { PreparedQuestion } from "../lifecycle/repository.ts";
import {
  interviewCreateFingerprint,
  losslessObject,
} from "../../../../modules/interviews/question/fingerprint.ts";
import { prepareCustomInterviewQuestion } from "./custom.ts";
import { readPublishedFixture } from "../../problems/private-content.ts";
import { object, storageProjection } from "../../problems/storage.ts";
const fail = (message: string) => new ApplicationError("invalid_input", message, 400);
/** Resolve an authorized published fixture inside the host's creation transaction. */
export async function preparePublishedInterviewQuestion(
  tx: Transaction,
  actor: Principal,
  command: InterviewCreate,
): Promise<PreparedQuestion> {
  if (!command.question || typeof command.question !== "object" || Array.isArray(command.question))
    throw fail("Choose an existing question or custom question");
  const q = command.question as Record<string, unknown>;
  if (
    Object.keys(q).some((key) => !["hints", "problemVersionId", "custom", "language"].includes(key))
  )
    throw fail("Invalid question input");
  if (command.monitoring !== undefined && command.monitoring !== null) {
    if (
      typeof command.monitoring !== "object" ||
      Array.isArray(command.monitoring) ||
      Object.keys(command.monitoring).some((k) => !["paste", "focus"].includes(k)) ||
      Object.values(command.monitoring).some((v) => v !== null && typeof v !== "boolean")
    )
      throw fail("Invalid monitoring");
  }
  const custom = q.custom !== undefined && q.custom !== null;
  const published = typeof q.problemVersionId === "string" && q.problemVersionId !== "";
  if (custom === published || typeof q.language !== "string")
    throw fail("Choose an existing question or custom question");
  const fingerprint = await interviewCreateFingerprint(
    command.title,
    command.question,
    command.monitoring,
  );
  if (custom) {
    let value;
    try {
      value = losslessObject(q.custom);
    } catch {
      throw fail("Invalid custom question");
    }
    const prepared = await prepareCustomInterviewQuestion(
      tx,
      actor,
      value,
      q.language,
      fingerprint,
    );
    if (q.hints !== undefined && q.hints !== null) {
      if (
        typeof q.hints !== "object" ||
        Array.isArray(q.hints) ||
        Object.keys(q.hints).some((k) => !["topics", "complexity"].includes(k)) ||
        Object.values(q.hints).some((v) => v !== null && typeof v !== "boolean")
      )
        throw fail("Invalid hint visibility");
      const raw = prepared.lossless
        ? new TextDecoder("utf-8", { fatal: true }).decode(prepared.lossless)
        : prepared.safe;
      const fixture = object(parseLosslessJson(raw));
      fixture.hints = Object.fromEntries(Object.entries(q.hints).filter(([, v]) => v !== null)) as {
        [key: string]: JsonValue;
      };
      const stored = storageProjection(stringifyLosslessJson(fixture));
      prepared.safe = stored.safe;
      prepared.lossless = stored.lossless;
    }
    return prepared;
  }
  const picked = await readPublishedFixture(
    tx,
    actor.userId,
    q.problemVersionId as string,
    q.language,
  );
  if (!picked) throw new ApplicationError("not_found", "Question unavailable", 404);
  const content = object(parseLosslessJson(picked.content)),
    problem = object(content.problem);
  const implementations = Array.isArray(content.implementations)
    ? content.implementations.map(object)
    : [];
  const selected = implementations.find((item) => item.language === q.language);
  if (!selected) throw fail("Language unavailable for this question");
  const languages: JsonValue[] = implementations.map((item) => ({
    language: item.language ?? null,
    starterSource: item.starterSource ?? null,
    runtimeRevision: item.runtimeRevision ?? null,
    harnessRevision: item.harnessRevision ?? null,
  }));
  problem.languages = languages;
  problem.starterSource = picked.starterSource;
  problem.runtimeRevision = selected.runtimeRevision ?? null;
  const fixture: { [key: string]: JsonValue } = {
    problem,
    hiddenCases: content.hiddenCases ?? [],
    odysseyHiddenCases: content.odysseyHiddenCases ?? [],
    harnessRevision: selected.harnessRevision ?? "",
    referenceSource: selected.referenceSource ?? "",
    attribution: content.attribution ?? "",
  };
  if (q.hints !== undefined && q.hints !== null) {
    const hints = q.hints;
    if (typeof hints !== "object" || Array.isArray(hints)) throw fail("Invalid hint visibility");
    const h = hints as Record<string, unknown>;
    if (
      Object.keys(h).some((k) => !["topics", "complexity"].includes(k)) ||
      Object.values(h).some((v) => v !== null && typeof v !== "boolean")
    )
      throw fail("Invalid hint visibility");
    fixture.hints = Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null)) as {
      [key: string]: JsonValue;
    };
  }
  const raw = stringifyLosslessJson(fixture),
    stored = storageProjection(raw);
  return {
    safe: stored.safe,
    lossless: stored.lossless,
    source: picked.starterSource,
    language: picked.language,
    fingerprint,
  };
}
