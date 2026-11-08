/** @file api.test.ts @description Batch endpoint availability and typed recovery errors. @module admin */
import { afterEach, expect, it, vi } from "vitest";
import { editPublicationDraft, deleteQuestionPublication, mutateQuestionBatch } from "./api";
import { ApiError } from "../../api/client";
const mocks = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));
vi.mock("../../api/client", async (original) => ({
  ...(await original<typeof import("../../api/client")>()),
  api: () => ({ POST: mocks.post, DELETE: mocks.delete }),
}));
afterEach(() => vi.resetAllMocks());
it("preserves successful per-question results", async () => {
  const data = { items: [{ id: "question", status: "succeeded" }] };
  mocks.post.mockResolvedValue({ response: { status: 200 }, data });
  expect(
    await mutateQuestionBatch({
      action: "delete-drafts",
      items: [{ id: "question", revision: "1" }],
    }),
  ).toBe(data);
});
it("preserves passkey recovery on a protected endpoint", async () => {
  mocks.post.mockResolvedValue({
    response: { status: 403 },
    error: { error: { code: "step_up_required" } },
  });
  await expect(
    mutateQuestionBatch({
      action: "publish",
      items: [{ id: "question", revision: "1", visibility: "global" }],
    }),
  ).rejects.toBeInstanceOf(ApiError);
});

it("opens an existing publication as an edit without version controls", async () => {
  mocks.post.mockResolvedValue({ data: { id: "draft" }, response: { status: 200 } });
  await editPublicationDraft("publication");
  expect(mocks.post).toHaveBeenCalledWith("/v1/admin/question-publications/{id}/edit", {
    params: { path: { id: "publication" } },
  });
});

it("deletes a publication using only its revision", async () => {
  mocks.delete.mockResolvedValue({ data: { ok: true }, response: { status: 200 } });
  await deleteQuestionPublication({ id: "draft", revision: "3" } as Parameters<
    typeof deleteQuestionPublication
  >[0]);
  expect(mocks.delete).toHaveBeenCalledWith("/v1/admin/question-drafts/{id}/publication", {
    params: { path: { id: "draft" } },
    body: { revision: "3" },
  });
});
