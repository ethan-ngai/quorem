import assert from "node:assert/strict";
import { sourceHash, decodeCaseFrames, languageRuntime } from "../src/index.ts";
assert.equal(languageRuntime("python").revision, "python-3.12-v1");
assert.equal(
  await sourceHash(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
);
const bytes = new Uint8Array([3, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]);
async function* input() {
  yield bytes;
}
assert.equal(
  await decodeCaseFrames(input(), { stdoutBytes: 1, stderrBytes: 1 }, async () => {}),
  0,
);
const { compressCheckpointFrame, decompressCheckpointFrame } = await import("../src/index.ts");
const frame = new TextEncoder().encode('{"actual":9007199254740993}');
assert.deepEqual(await decompressCheckpointFrame(await compressCheckpointFrame(frame)), frame);
