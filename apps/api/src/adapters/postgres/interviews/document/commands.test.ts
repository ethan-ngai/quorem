import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { applyDocumentChanges } from "../../../../modules/interviews/document/changes.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshotStream } from "../question/stream.ts";
import { interviewQuestionCommands } from "../question/commands.ts";
import { interviewDocumentCommands } from "./commands.ts";
import { interviewCommandFingerprint } from "../../../../modules/interviews/question/fingerprint.ts";
import { markRawDocumentChanges } from "../../problems/case-literals.ts";
const url = process.env.QUOREM_INTERVIEW_DOCUMENT_TEST_URL;
const actor = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
describe("CodeMirror changes", () => {
  it("matches Go raw ChangeSet operation fingerprint", async () => {
    const raw = String.raw`{"epoch":"e","version":0,"updates":[{"clientID":"a","changes":[[0,"\u0061"]]}]}`;
    const batch = JSON.parse(raw);
    const marks = markRawDocumentChanges(raw, batch.updates);
    expect(
      await interviewCommandFingerprint(
        "room:updates",
        { version: batch.version, epoch: batch.epoch, updates: batch.updates },
        marks,
      ),
    ).toBe("55ba0e0f54eb6288ae4927d365bc7ef3e33d4018cd8be519ea5f97c164275b11");
  });
  it("matches Go vectors and rejects malformed source", () => {
    for (const [source, changes, want] of [
      ["abc", [1, [1, "XYZ"], 1], "aXYZc"],
      ["hello", [[0, "new", ""], 5], "new\nhello"],
      ["a😀b", [3, [0, "!"], 1], "a😀!b"],
      ["a😀b", [1, [2, "🦊"], 1], "a🦊b"],
      ["abc", [[3]], ""],
      ["", [], ""],
    ] as const)
      expect(applyDocumentChanges(source, changes)).toBe(want);
    for (const changes of [
      null,
      [null, 3],
      [[null, "x"], 3],
      [4],
      [2],
      [1.5],
      [-1],
      [[0, 2], 3],
      [[0, "a\nb"], 3],
      [{}],
    ])
      expect(() => applyDocumentChanges("abc", changes)).toThrow();
    for (const changes of [
      [[0, "\ud800"]],
      [[0, "\udfff"]],
      [[0, "\u0000"]],
      [[0, "x".repeat(65537)]],
    ])
      expect(() => applyDocumentChanges("", changes)).toThrow();
    expect(() => applyDocumentChanges("😀", [1, [1]])).toThrow();
  });
});
describe.skipIf(!url)("document PostgreSQL", () => {
  it("serializes updates, lost ACK, stale/offline pulls and language drafts", async () => {
    const db = new URL(url!);
    expect([db.hostname, db.port, db.pathname]).toEqual([
      "127.0.0.1",
      "55468",
      "/quorem_hono_interview_documents_test",
    ]);
    const pool = createNodePool({
        connectionString: url!,
        max: 8,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 5000,
        onIdleError: () => {},
      }),
      host = actor(`document-${crypto.randomUUID()}`);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host')", [host.userId]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host.userId],
      );
      const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
      const lifecycle = interviewLifecycle(run, {
          question: preparePublishedInterviewQuestion,
          snapshot: interviewSnapshotStream(run),
        }),
        docs = interviewDocumentCommands(run),
        questions = interviewQuestionCommands(run);
      const created = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await lifecycle.create(host, "create", {
                title: "Document",
                question: {
                  problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
                  language: "python",
                },
              }),
            ).id,
          ),
        ).text(),
      );
      const id = created.id,
        initial = await docs.read(host, id),
        update = {
          epoch: initial.epoch,
          version: 0,
          updates: [{ clientID: "a", changes: [[0, "😀"], initial.source.length] }],
        };
      const [first, second] = await Promise.allSettled([
        docs.push(host, id, "one", update),
        docs.push(host, id, "two", update),
      ]);
      expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
      const key = first.status === "fulfilled" ? "one" : "two";
      expect(await docs.push(host, id, key, update)).toEqual({ ...update, version: 1 });
      expect((await docs.read(host, id)).source).toBe("😀" + initial.source);
      expect((await docs.pull(host, id, initial.epoch, 0)).updates).toEqual(update.updates);
      await expect(docs.push(host, id, "stale", update)).rejects.toMatchObject({
        code: "stale_version",
      });
      const switched = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(await questions.language(host, id, "java", "java", initial.epoch)).id,
          ),
        ).text(),
      );
      await expect(docs.pull(host, id, initial.epoch, 0)).rejects.toMatchObject({
        code: "document_changed",
      });
      const restored = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await questions.language(host, id, "python", "python", switched.document.epoch),
            ).id,
          ),
        ).text(),
      );
      expect(restored.document.source).toBe("😀" + initial.source);
      expect(restored.document.version).toBe(0);
      const blank = { clientID: "offline", changes: [restored.document.source.length] };
      for (let i = 0; i < 9; i++) {
        const count = i === 8 ? 1 : 32;
        await docs.push(host, id, `batch-${i}`, {
          epoch: restored.document.epoch,
          version: i * 32,
          updates: Array(count).fill(blank),
        });
      }
      const page = await docs.pull(host, id, restored.document.epoch, 0);
      expect([page.version, page.updates.length]).toEqual([256, 256]);
      expect(
        (await docs.pull(host, id, restored.document.epoch, page.version)).updates,
      ).toHaveLength(1);
      const large = "z".repeat(20000);
      await docs.push(host, id, "large-first", {
        epoch: restored.document.epoch,
        version: 257,
        updates: [{ clientID: "large", changes: [[restored.document.source.length, large]] }],
      });
      const largeUpdate = { clientID: "large", changes: [[large.length, large]] };
      for (let i = 0; i < 2; i++)
        await docs.push(host, id, `large-${i}`, {
          epoch: restored.document.epoch,
          version: 258 + i * 10,
          updates: Array(10).fill(largeUpdate),
        });
      let cursor = 257,
        total = 0;
      while (cursor < 278) {
        const part = await docs.pull(host, id, restored.document.epoch, cursor);
        expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(245760);
        expect(part.version).toBeGreaterThan(cursor);
        total += part.updates.length;
        cursor = part.version;
      }
      expect(total).toBe(21);
      const before = await docs.read(host, id);
      await expect(
        docs.push(host, id, "atomic", {
          epoch: before.epoch,
          version: before.version,
          updates: [blank, { clientID: "bad", changes: [999999] }],
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(await docs.read(host, id)).toEqual(before);
      await pool.query(
        "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [host.userId],
      );
      await expect(
        docs.push(host, id, "revoked", {
          epoch: before.epoch,
          version: before.version,
          updates: [blank],
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await pool.end();
    }
  });
});
