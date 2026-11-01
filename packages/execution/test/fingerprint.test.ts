import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalWorkspaceCommand } from "../src/fingerprint.ts";

describe("Go execution command fingerprint bytes", () => {
  it("matches the actual judging.Command encoder including opaque raw values", () => {
    const cases = [
      '{"workspaceId":"00000000-0000-4000-8000-000000000001","kind":"run","source":"x < y & z"}',
      '{"level":2,"workspaceId":"w","kind":"run","source":"π","customCases":[{"args":[{"z":9007199254740993,"a":"<x>"}],"expected":1e+10}]}',
      '{"workspaceId":"w","kind":"run","source":"", "customCases":[{"calls":[{"methodName":"get","args":[{"10":0,"2":1}],"expected":null}],"args":[]}]}',
      '{"workspaceId":"w","kind":"submit","source":"\\u003cscript\\u003e","customCases":[]}',
    ];
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const actual = execFileSync("go", ["run", "./apps/api/internal/judging/testdata/fingerprint"], {
      cwd: root,
      input: cases.join("\n") + "\n",
      encoding: "utf8",
    })
      .trimEnd()
      .split("\n");
    expect(cases.map(canonicalWorkspaceCommand)).toEqual(actual);
  }, 30000);
});
