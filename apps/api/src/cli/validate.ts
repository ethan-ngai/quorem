/** @file validate.ts @description Validate candidate questions without publication. @module cli */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { languageRuntime } from "@quorem/execution";
import {
  normalizeQuestionDraft,
  findPrimarySignature,
  structuredConstraintSuggestion,
  type QuestionContent,
  validateQuestionPublication,
  validateQuestionSchema,
} from "@quorem/questions";

export async function validateDirectory(
  directory: string,
  output: (line: string) => void,
): Promise<void> {
  const paths = (await readdir(directory)).filter((p) => p.endsWith(".json")).sort();
  for (const path of paths) {
    const bytes = await readFile(join(directory, path));
    const entry = {
      id: basename(path, ".json"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      error: "",
      warnings: [] as string[],
    };
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const normalized = normalizeQuestionDraft(raw);
      validateQuestionPublication(normalized, validateQuestionSchema, languageRuntime);
      const { problem } = JSON.parse(normalized) as QuestionContent;
      const signature = findPrimarySignature(problem);
      if (signature)
        problem.constraints.forEach((rule, index) => {
          if (rule.kind === "prose" && structuredConstraintSuggestion(signature, rule.text))
            entry.warnings.push(`constraint ${index + 1}: use a structured rule for this note`);
        });
    } catch (error) {
      entry.error = error instanceof Error ? error.message : "Invalid question";
    }
    output(JSON.stringify(entry));
  }
}
if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error("Usage: validate <directory>");
  await validateDirectory(resolve(process.argv[2]!), (line) => process.stdout.write(`${line}\n`));
}
