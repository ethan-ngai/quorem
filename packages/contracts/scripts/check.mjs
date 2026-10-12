/** @file check.mjs @description Validate fixtures and generated contract drift. @module contracts */
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateContracts } from "./generate.mjs";

const api = JSON.parse(readFileSync("openapi/api.json", "utf8"));
const schemas = JSON.parse(
  JSON.stringify(api.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
);
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const document = { $id: "https://quorem.local/api", $defs: schemas };
ajv.addSchema(document);
const fixtures = JSON.parse(readFileSync("fixtures/solo.json", "utf8"));
for (const [fixture, schema] of Object.entries({
  createWorkspace: "CreateWorkspaceRequest",
  createSubmission: "CreateSubmissionRequest",
  submission: "Submission",
})) {
  const validate = ajv.compile({ $ref: `${document.$id}#/$defs/${schema}` });
  assert(validate(fixtures[fixture]), JSON.stringify(validate.errors));
}
const validateProblem = ajv.compile({ $ref: `${document.$id}#/$defs/ProblemVersion` });
for (const name of readdirSync("../../fixtures/problems")) {
  const fixture = JSON.parse(readFileSync(`../../fixtures/problems/${name}`, "utf8"));
  assert(validateProblem(fixture.problem), `${name}: ${JSON.stringify(validateProblem.errors)}`);
}
const validateHidden = ajv.compile({ $ref: `${document.$id}#/$defs/HiddenCaseResult` });
for (const status of schemas.HiddenCaseResult.properties.status.enum)
  assert(validateHidden({ index: 0, status }));
for (const hidden of [
  { index: -1, status: "accepted" },
  { index: 0, status: "executed" },
  ...schemas.Verdict.enum
    .filter((status) => !schemas.HiddenCaseResult.properties.status.enum.includes(status))
    .map((status) => ({ index: 0, status })),
  ...["args", "actual", "expected", "diagnostics", "stdout", "stderr"].map((key) => ({
    index: 0,
    status: "accepted",
    [key]: "hidden-marker",
  })),
])
  assert(!validateHidden(hidden), JSON.stringify(hidden));
const validateInput = ajv.compile({ $ref: `${document.$id}#/$defs/InputPresetConfig` });
assert(validateInput({ preset: "sequence", placeholder: "[1, 2]", rows: 8 }));
for (const input of [
  { preset: "" },
  { preset: "text", rows: 0 },
  { preset: "text", rows: 9 },
  { preset: "text", rows: 1.5 },
  { preset: "text", placeholder: "x".repeat(513) },
  { preset: "text", unknown: true },
  { preset: "text", rows: null },
])
  assert(!validateInput(input), JSON.stringify(input));
const submissionCommand = ajv.compile({ $ref: `${document.$id}#/$defs/CreateSubmissionRequest` });
assert(!submissionCommand({ ...fixtures.createSubmission, ownerId: "alice" }));
assert(!submissionCommand({ ...fixtures.createSubmission, workspaceId: undefined }));
assert(!submissionCommand({ ...fixtures.createSubmission, customCases: [{ args: [2147483648] }] }));
const eventSchema = JSON.parse(readFileSync("events/envelope.schema.json", "utf8"));
const event = {
  eventId: fixtures.submission.id,
  schemaVersion: 1,
  aggregateId: fixtures.submission.id,
  aggregateVersion: "9007199254740993",
  type: "submission.updated",
  occurredAt: fixtures.submission.updatedAt,
  payload: fixtures.submission,
};
assert.deepEqual(eventSchema.$defs, schemas, "Event schemas must match OpenAPI");
const validateEvent = ajv.compile(eventSchema);
assert(validateEvent(event), JSON.stringify(validateEvent.errors));
assert(!validateEvent({ ...event, payload: { ...event.payload, source: "private" } }));
assert(
  validateEvent({
    ...event,
    payload: { ...event.payload, hiddenCases: [{ index: 0, status: "accepted" }] },
  }),
);
assert(
  !validateEvent({
    ...event,
    payload: {
      ...event.payload,
      hiddenCases: [{ index: 0, status: "accepted", stdout: "hidden-marker" }],
    },
  }),
);
assert.equal(
  readFileSync("src/generated.ts", "utf8"),
  await generateContracts(),
  "Run vp run contracts:generate",
);
console.log("Contract fixtures, redaction, decimal sequences and generation verified.");
