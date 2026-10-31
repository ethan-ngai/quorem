import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { copyProfilePhotoPage } from "./profile-object-cutover.ts";
const key = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const digest = async (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const references = async () => ({
  rows: [{ id: "1", image: `/api/auth/profile-photos/${key}` }],
  next: undefined,
});
const source = { get: async () => new Uint8Array([1, 2, 3]) };

test("audit is read-only and never claims writer quiescence", async () => {
  let writes = 0;
  const result = await copyProfilePhotoPage({
    references,
    source,
    destination: {
      get: async () => undefined,
      putIfAbsent: async () => {
        writes++;
        return true;
      },
    },
    digest,
    limit: 1,
    apply: false,
  });
  assert.deepEqual(result, {
    checked: 1,
    missing: 1,
    copied: 0,
    next: undefined,
    complete: true,
    cutoverReady: false,
  });
  assert.equal(writes, 0);
});
test("copy rereads destination and replay avoids rewriting", async () => {
  let value: Uint8Array | undefined,
    writes = 0;
  const destination = {
    get: async () => value,
    putIfAbsent: async (_key: string, bytes: Uint8Array) => {
      writes++;
      value ??= bytes;
      return true;
    },
  };
  const run = () =>
    copyProfilePhotoPage({ references, source, destination, digest, limit: 1, apply: true });
  assert.equal((await run()).copied, 1);
  assert.equal((await run()).copied, 0);
  assert.equal(writes, 1);
});
test("missing source and mismatched destination fail closed", async () => {
  const destination = {
    get: async () => new Uint8Array([7]),
    putIfAbsent: async () => {
      throw new Error("unexpected");
    },
  };
  await assert.rejects(
    copyProfilePhotoPage({ references, source, destination, digest, limit: 1, apply: true }),
    /mismatch/,
  );
  await assert.rejects(
    copyProfilePhotoPage({
      references,
      source: { get: async () => undefined },
      destination,
      digest,
      limit: 1,
      apply: false,
    }),
    /source/,
  );
});
test("concurrent create is rechecked before claiming success", async () => {
  let target: Uint8Array | undefined;
  const destination = {
    get: async () => target,
    putIfAbsent: async () => {
      target = new Uint8Array([9]);
      return false;
    },
  };
  await assert.rejects(
    copyProfilePhotoPage({ references, source, destination, digest, limit: 1, apply: true }),
    /mismatch/,
  );
});
test("invalid references are ignored and page sizes bounded", async () => {
  const destination = {
    get: async () => {
      throw new Error("unexpected");
    },
    putIfAbsent: async () => {
      throw new Error("unexpected");
    },
  };
  const invalid = async () => ({
    rows: [{ id: "1", image: `/api/auth/profile-photos/${key}?x` }],
    next: "1",
  });
  const result = await copyProfilePhotoPage({
    references: invalid,
    source,
    destination,
    digest,
    limit: 1,
    apply: true,
  });
  assert.equal(result.next, "1");
  assert.equal(result.checked, 0);
  assert.equal(result.complete, false);
  await assert.rejects(
    copyProfilePhotoPage({ references, source, destination, digest, limit: 65, apply: true }),
    /limit/,
  );
});
