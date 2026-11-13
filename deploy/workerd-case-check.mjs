/** Exercise the real Worker/Container stream and fail-closed local isolation. */
import assert from "node:assert/strict";

const base = process.env.QUOREM_WORKER_TEST_ORIGIN || "http://localhost:8796";
const url = base + "/internal/case/workerd-" + crypto.randomUUID();
const headers = {
  Authorization: "Bearer local-contract-fixture-token-at-least-32-chars",
  "X-Case-Language": "python",
  "X-Case-Memory": "268435456",
  "X-Case-Processes": "16",
};
const fixture = {
  source: "class Solution:\n def solve(self, value): return value",
  signature: {
    parameters: [{ name: "value", type: "int" }],
    methodName: "solve",
    returnType: "int",
  },
  args: [7],
};
const input = JSON.stringify(fixture);
assert.equal((await fetch(url, { method: "POST", body: input })).status, 404);
const exits = await Promise.all(
  Array.from({ length: 4 }, async (_, ordinal) => {
    const expected = ordinal + 7;
    const caseHeaders = new Headers(headers);
    caseHeaders.set("X-Case-Token", crypto.randomUUID());
    caseHeaders.set("X-Quorem-Case-Ordinal", String(ordinal));
    const input = JSON.stringify({
      ...fixture,
      args: [expected],
    });
    const response = await fetch(url, { method: "POST", headers: caseHeaders, body: input });
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0,
      output = [],
      exit,
      teardown = false;
    while (offset < bytes.length) {
      assert.ok(offset + 8 <= bytes.length);
      const channel = bytes[offset],
        length = view.getUint32(offset + 4);
      offset += 8;
      assert.ok(offset + length <= bytes.length);
      if (channel === 1) output.push(...bytes.subarray(offset, offset + length));
      else if (channel === 3) {
        assert.equal(length, 4);
        exit = view.getInt32(offset);
      } else if (channel === 4) {
        assert.equal(length, 0);
        assert.notEqual(exit, undefined);
        teardown = true;
      } else assert.equal(channel, 2);
      offset += length;
    }
    assert.equal(teardown, true);
    if (exit === 0) {
      assert.equal(output[0], 0);
      assert.equal(
        JSON.parse(new TextDecoder().decode(new Uint8Array(output.slice(1)))).actual,
        expected,
      );
    } else {
      // Local workerd does not grant the cgroup privileges required by the hosted launcher.
      assert.equal(exit, 125);
      assert.equal(output.length, 0);
    }
    return exit;
  }),
);
assert.equal(new Set(exits).size, 1);
assert.equal((await fetch(url, { method: "DELETE", headers })).status, 204);
assert.equal(
  (
    await fetch(url, {
      method: "POST",
      headers: { ...headers, "X-Case-Token": crypto.randomUUID() },
      body: input,
    })
  ).status,
  503,
);
console.log(
  `workerd: case authentication, four concurrent case streams (exit ${exits[0]}), teardown and attempt fencing passed`,
);
