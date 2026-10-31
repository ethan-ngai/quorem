/** @file runtime.ts @description Supported immutable runtime and harness revision pairs. @module execution */
export interface Runtime {
  readonly language: string;
  readonly revision: string;
  readonly harness: string;
  readonly image: string;
}
const runtimes: readonly Runtime[] = Object.freeze([
  Object.freeze({
    language: "python",
    revision: "python-3.12-v1",
    harness: "quorem-harness-v2",
    image: "quorem-python:local",
  }),
  Object.freeze({
    language: "postgresql",
    revision: "postgresql-17.6-v1",
    harness: "quorem-postgresql-v2",
    image: "quorem-postgres:local",
  }),
  Object.freeze({
    language: "postgresql",
    revision: "postgresql-17.6-v1",
    harness: "quorem-postgresql-v1",
    image: "quorem-postgres:local",
  }),
  Object.freeze({
    language: "java",
    revision: "java-21.0.9-v1",
    harness: "quorem-java-v1",
    image: "quorem-java:local",
  }),
  Object.freeze({
    language: "typescript",
    revision: "typescript-5.9.3-node-22.21.1-v1",
    harness: "quorem-typescript-v1",
    image: "quorem-typescript:local",
  }),
  Object.freeze({
    language: "ocaml",
    revision: "ocaml-4.13.1-v1",
    harness: "quorem-ocaml-v1",
    image: "quorem-ocaml:local",
  }),
]);
/** Return the current admission runtime for a language. */
export function languageRuntime(language: string): Runtime | undefined {
  return runtimes.find((r) => r.language === language);
}
/** Resolve a stored revision pair, including supported historical harnesses. */
export function runtimeForRevision(revision: string, harness: string): Runtime | undefined {
  return runtimes.find((r) => r.revision === revision && r.harness === harness);
}
/** Return the current default execution limits. */
export function defaultLimits() {
  return {
    wallTimeMs: 2000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  };
}
