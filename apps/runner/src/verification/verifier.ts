/** @file verifier.ts @description Independent one-case result verifier. @module runner */
import { createHash } from "node:crypto";
import {
  manifestCaseBinding,
  verificationReceiptBytes,
  type ExecutionInputReader,
  type InputBlobRef,
  type InputPage,
  type Job,
  type VerificationReceipt,
} from "@quorem/execution";
import {
  compareCodingCase,
  compareSqlResult,
  parseLosslessJson,
  stringifyLosslessJson,
  JsonNumber,
  type JsonValue,
  type QuestionProblem,
  type Signature,
} from "@quorem/questions";
import { spoolInput } from "../checkpoints/input-spool.ts";

export interface FrozenCase {
  readonly challenge: string;
  readonly job: Job;
  readonly ordinal: number;
  readonly frameHash: string;
  readonly status: string;
  readonly actual: InputBlobRef | null;
  readonly sqlTypes: InputBlobRef | null;
}
/** Both methods address only server-frozen state. The caller supplies no expected values. */
export interface VerificationSource {
  readonly inputs: ExecutionInputReader;
  frozenCase(challenge: string, signal?: AbortSignal): Promise<FrozenCase>;
  fieldPage(
    challenge: string,
    field: "actual" | "sqlTypes",
    offset: number,
    signal?: AbortSignal,
  ): Promise<InputPage>;
  putField(
    challenge: string,
    field: "actual" | "expected",
    bytes: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void>;
}
async function read(spool: Awaited<ReturnType<typeof spoolInput>>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of spool.stream()) chunks.push(chunk as Uint8Array);
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
function object(value: JsonValue): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid admitted case");
  return value;
}
/** Reads one verified case at a time; all temporary files are removed before returning. */
export function nodeResultVerifier(source: VerificationSource, privateKey: CryptoKey) {
  if (privateKey.type !== "private" || privateKey.algorithm.name !== "Ed25519")
    throw new Error("Invalid verifier signing key");
  return async (
    challenge: string,
    signal?: AbortSignal,
  ): Promise<{ receipt: VerificationReceipt; signature: Uint8Array }> => {
    const frozen = await source.frozenCase(challenge, signal);
    if (frozen.challenge !== challenge) throw new Error("Verification challenge mismatch");
    const { job, ordinal } = frozen;
    const manifest = await source.inputs.inputManifest(job, signal);
    const ref = await source.inputs.inputCaseRef(job, ordinal, signal);
    const binding = await manifestCaseBinding(job, manifest, ref, ordinal, job);
    const metadata = await spoolInput({
      reader: source.inputs,
      job,
      kind: "metadata",
      ordinal: 0,
      expected: manifest.metadata,
      signal,
    });
    try {
      const testcase = await spoolInput({
        reader: source.inputs,
        job,
        kind: "case",
        ordinal,
        expected: ref,
        expectedChannel: ref.channel,
        signal,
      });
      try {
        const problem = JSON.parse(await read(metadata)) as QuestionProblem;
        const input = await read(testcase);
        const status = frozen.status;
        if (
          ![
            "accepted",
            "wrong_answer",
            "executed",
            "syntax_error",
            "runtime_error",
            "time_limit",
            "memory_limit",
            "output_limit",
            "invalid_output",
          ].includes(status)
        )
          throw new Error("Invalid frame status");
        async function frozenField(
          field: "actual" | "sqlTypes",
          expected: InputBlobRef | null,
        ): Promise<string | undefined> {
          if (!expected) return undefined;
          const reader: ExecutionInputReader = {
            ...source.inputs,
            inputPage: (_job, _kind, _ordinal, offset, signal) =>
              source.fieldPage(challenge, field, offset, signal),
          };
          const spool = await spoolInput({
            reader,
            job,
            kind: "source",
            ordinal: 0,
            expected,
            signal,
          });
          try {
            return await read(spool);
          } finally {
            await spool.dispose();
          }
        }
        let result: { status: string; actual?: string; expected?: string; typeMismatch?: boolean };
        if (!["accepted", "wrong_answer", "executed"].includes(status)) result = { status };
        else {
          const actual = await frozenField("actual", frozen.actual);
          if (actual === undefined) throw new Error("Missing actual result");
          const typesValue: unknown = JSON.parse(
            (await frozenField("sqlTypes", frozen.sqlTypes)) ?? "[]",
          );
          if (!Array.isArray(typesValue) || typesValue.some((value) => typeof value !== "string"))
            throw new Error("Invalid SQL types");
          const sqlTypes = typesValue as string[];
          if (problem.sql) {
            const item = object(parseLosslessJson(input));
            result = compareSqlResult(
              problem.sql,
              "executed",
              actual,
              item.expected === undefined ? undefined : stringifyLosslessJson(item.expected),
              sqlTypes,
            );
          } else {
            const methods: Signature[] = (problem.odyssey?.levels ?? [])
              .slice(0, manifest.level ?? 0)
              .flatMap((level) => level.methods);
            result = compareCodingCase(problem.signature, methods, input, "executed", actual);
          }
        }
        async function field(
          name: "actual" | "expected",
          value: string | undefined,
        ): Promise<string | null> {
          if (value === undefined) return null;
          const bytes = new TextEncoder().encode(value);
          const hash = createHash("sha256").update(bytes).digest("hex");
          await source.putField(
            challenge,
            name,
            (async function* () {
              for (let i = 0; i < bytes.length; i += 65536) yield bytes.subarray(i, i + 65536);
            })(),
            signal,
          );
          return hash;
        }
        const receipt: VerificationReceipt = {
          challenge,
          jobId: job.jobId,
          submissionId: job.submissionId,
          attemptId: job.attemptId,
          sandboxScope: job.sandboxScope,
          binding,
          frameHash: frozen.frameHash,
          ordinal,
          channel: ref.channel,
          status: result.status,
          typeMismatch: result.typeMismatch ?? false,
          actualHash: await field("actual", result.actual),
          expectedHash: await field("expected", result.expected),
        };
        const signature = new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            privateKey,
            new Uint8Array(verificationReceiptBytes(receipt)),
          ),
        );
        return { receipt, signature };
      } finally {
        await testcase.dispose();
      }
    } finally {
      await metadata.dispose();
    }
  };
}
