/** @file compile-fixture.ts @description Generated custom cases compile through the HTTP client. @module contracts */
import { createApiClient, type CustomCase, type CreateSubmissionRequest } from "./index";
const customCases: CustomCase[] = [{ args: [[1, 2], null, true, 1.25], expected: [3] }];
const body: CreateSubmissionRequest = {
  workspaceId: "fixture",
  kind: "run",
  source: "",
  customCases,
};
const client = createApiClient();
export const admitFixture = () =>
  client.POST("/v1/submissions", {
    params: { header: { "Idempotency-Key": "compile-fixture" } },
    body,
  });
