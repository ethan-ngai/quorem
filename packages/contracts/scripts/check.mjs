/** @file check.mjs @description Validate fixtures and generated contract drift. @module contracts */
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateContracts } from "./generate.mjs";
import { questionSchema } from "./question-schema.mjs";
import { eventSchema as generateEventSchema } from "./event-schema.mjs";
assert.deepEqual(
  JSON.parse(readFileSync("questions/question-v1.schema.json", "utf8")),
  questionSchema(),
  "Question import schema must match OpenAPI",
);

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
const publicFields = schemas.ProblemVersion.properties;
const authorFields = schemas.QuestionProblem.properties;
assert.deepEqual(Object.keys(authorFields).sort(), Object.keys(publicFields).sort());
for (const name of Object.keys(authorFields)) {
  if (name !== "id" && name !== "version")
    assert.deepEqual(authorFields[name], publicFields[name], `Question field drift: ${name}`);
}
const validateQuestion = ajv.compile({ $ref: `${document.$id}#/$defs/QuestionContent` });
const exampleQuestion = JSON.parse(readFileSync("questions/example-v1.json", "utf8"));
exampleQuestion.problem.isPrivate = true;
exampleQuestion.problem.solutionLanguages = ["python"];
exampleQuestion.problem.complexityLanguages = ["python"];
assert(validateQuestion(exampleQuestion), JSON.stringify(validateQuestion.errors));
const validateProblem = ajv.compile({ $ref: `${document.$id}#/$defs/ProblemVersion` });
for (const name of readdirSync("../../fixtures/problems")) {
  const fixture = JSON.parse(readFileSync(`../../fixtures/problems/${name}`, "utf8"));
  assert(validateProblem(fixture.problem), `${name}: ${JSON.stringify(validateProblem.errors)}`);
  assert(validateQuestion(fixture), `${name}: ${JSON.stringify(validateQuestion.errors)}`);
}
const validateInterviewCustom = ajv.compile({
  $ref: `${document.$id}#/$defs/InterviewCustomQuestion`,
});
const authoredStages = JSON.parse(
  readFileSync("../../fixtures/odyssey/balance-ledger.json", "utf8"),
);
const stagedPad = {
  title: "Private stages",
  statementMarkdown: "Implement each stage.",
  signature: authoredStages.problem.signature,
  starterSource: authoredStages.problem.starterSource,
  publicCases: authoredStages.problem.odyssey.levels[0].examples.map(({ args, calls }) => ({
    args,
    calls,
  })),
  privateCases: [],
  odyssey: authoredStages.problem.odyssey,
  odysseyHiddenCases: authoredStages.odysseyHiddenCases,
};
assert(validateInterviewCustom(stagedPad), JSON.stringify(validateInterviewCustom.errors));
for (const missing of ["odyssey", "odysseyHiddenCases"]) {
  const invalid = { ...stagedPad };
  delete invalid[missing];
  assert(!validateInterviewCustom(invalid), `Private stages require ${missing}`);
}
assert(
  !validateInterviewCustom({
    ...stagedPad,
    odyssey: { levels: Array(9).fill(stagedPad.odyssey.levels[0]) },
  }),
);
assert(
  !validateInterviewCustom({
    ...stagedPad,
    odysseyHiddenCases: [Array(21).fill(stagedPad.odysseyHiddenCases[0][0])],
  }),
);
const interviewExecutionSchema =
  api.paths["/v1/interviews/{id}/submissions"].post.requestBody.content["application/json"].schema;
const validateInterviewExecution = ajv.compile(
  JSON.parse(
    JSON.stringify(interviewExecutionSchema).replaceAll(
      "#/components/schemas/",
      `${document.$id}#/$defs/`,
    ),
  ),
);
const interviewExecution = {
  kind: "run",
  questionEpoch: "00000000-0000-4000-8000-000000000001",
  documentEpoch: "00000000-0000-4000-8000-000000000002",
  sourceHash: "a".repeat(64),
};
assert(
  validateInterviewExecution(interviewExecution),
  JSON.stringify(validateInterviewExecution.errors),
);
for (const field of ["questionEpoch", "documentEpoch", "sourceHash"]) {
  assert(!validateInterviewExecution({ ...interviewExecution, [field]: undefined }), field);
}
assert(!validateInterviewExecution({ ...interviewExecution, sourceHash: "invalid" }));
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
const validateMatchRequest = ajv.compile({ $ref: `${document.$id}#/$defs/CreateMatchRequest` });
const problemId = fixtures.submission.id;
for (const request of [
  { difficulty: "easy", durationMinutes: 30 },
  { mode: "free-for-all", difficulties: ["easy", "hard"], durationMinutes: 15 },
  {
    selectedProblemVersionId: problemId,
    durationMinutes: 60,
    rules: { clipboard: "warning", focus: "announce" },
  },
])
  assert(validateMatchRequest(request), JSON.stringify(validateMatchRequest.errors));
for (const request of [
  { durationMinutes: 30 },
  { difficulties: [], durationMinutes: 30 },
  { difficulties: ["easy", "easy"], durationMinutes: 30 },
  { difficulties: ["expert"], durationMinutes: 30 },
  { selectedProblemVersionId: "private", durationMinutes: 30 },
  { difficulty: "easy", durationMinutes: 1 },
  { difficulty: "easy", durationMinutes: 30, mode: "unknown" },
  { difficulty: "easy", durationMinutes: 30, rules: { focus: "ban" } },
  { difficulty: "easy", durationMinutes: 30, rules: { clipboard: "cooldown" } },
  { difficulty: "easy", durationMinutes: 30, rules: { focus: "cooldown" } },
  { difficulty: "easy", durationMinutes: 30, rules: { clipboard: "off", contents: "private" } },
])
  assert(!validateMatchRequest(request), JSON.stringify(request));
const match = {
  id: problemId,
  version: "1",
  state: "waiting",
  serverNow: fixtures.submission.updatedAt,
  expiresAt: fixtures.submission.updatedAt,
  hostUserId: problemId,
  mode: "free-for-all",
  difficulty: "easy",
  difficulties: ["easy", "medium"],
  durationMinutes: 30,
  rules: { clipboard: "warning", focus: "announce" },
  ruleEvents: [],
  participants: [{ userId: problemId, displayName: "Alice", ready: false, presence: "online" }],
};
const validateMatch = ajv.compile({ $ref: `${document.$id}#/$defs/MatchSnapshot` });
assert(validateMatch(match), JSON.stringify(validateMatch.errors));
for (const key of ["mode", "difficulties", "rules", "ruleEvents"])
  assert(!validateMatch({ ...match, [key]: undefined }), key);
const ruleEvent = {
  id: problemId,
  userId: problemId,
  kind: "focus",
  action: "announce",
  occurredAt: fixtures.submission.updatedAt,
};
assert(validateMatch({ ...match, ruleEvents: [ruleEvent] }));
assert(!validateMatch({ ...match, ruleEvents: Array(21).fill(ruleEvent) }));
assert(!validateMatch({ ...match, ruleEvents: [{ ...ruleEvent, clipboard: "private" }] }));
assert(!validateMatch({ ...match, participants: Array(9).fill(match.participants[0]) }));
const validateRuleRequest = ajv.compile({ $ref: `${document.$id}#/$defs/ReportMatchRuleRequest` });
assert(validateRuleRequest({ kind: "clipboard" }));
assert(!validateRuleRequest({ kind: "clipboard", contents: "private" }));
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
assert.deepEqual(eventSchema, generateEventSchema(), "Run vp run contracts:generate");
const validateEvent = ajv.compile(eventSchema);
assert(validateEvent(event), JSON.stringify(validateEvent.errors));
assert(validateEvent({ ...event, type: "match.updated", payload: match }));
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
