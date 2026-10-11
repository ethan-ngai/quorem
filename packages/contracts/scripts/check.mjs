/** @file check.mjs @description Validate fixtures and generated contract drift. @module contracts */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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
  saveDraft: "SaveDraftRequest",
  createSubmission: "CreateSubmissionRequest",
  submission: "Submission",
})) {
  const validate = ajv.compile({ $ref: `${document.$id}#/$defs/${schema}` });
  assert(validate(fixtures[fixture]), JSON.stringify(validate.errors));
}
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
const temp = mkdtempSync(join(tmpdir(), "quorem-contracts-"));
try {
  const generated = join(temp, "generated.ts");
  execFileSync("openapi-typescript", ["openapi/api.json", "-o", generated], { stdio: "pipe" });
  assert.equal(
    readFileSync("src/generated.ts", "utf8"),
    readFileSync(generated, "utf8"),
    "Run vp run contracts:generate",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log("Contract fixtures, redaction, decimal sequences and generation verified.");
