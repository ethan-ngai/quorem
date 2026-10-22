/** @file Exercise actual compiler member inference and judge-provided types. */
import { describe, expect, it } from "vitest";
import { createBrowserTypeScriptEnvironment } from "./browserTypeScriptEnvironment";

describe("browser TypeScript intelligence", () => {
  it("completes array and string members using bundled standard libraries", () => {
    const env = createBrowserTypeScriptEnvironment();
    for (const [expression, member] of [
      ["[1, 2]", "map"],
      ['"hello"', "toUpperCase"],
    ]) {
      const code = `const value = ${expression};\nvalue.`;
      env.createFile("/main.ts", code);
      const completions = env.languageService.getCompletionsAtPosition("/main.ts", code.length, {});
      expect(completions?.entries.some((entry) => entry.name === member)).toBe(true);
      expect(completions?.isMemberCompletion).toBe(true);
    }
  });

  it("understands public node types and reports type errors", () => {
    const env = createBrowserTypeScriptEnvironment();
    const code = "const node = new TreeNode();\nnode.";
    env.createFile("/main.ts", code);
    const completions = env.languageService.getCompletionsAtPosition("/main.ts", code.length, {});
    expect(completions?.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["val", "left", "right"]),
    );
    env.updateFile("/main.ts", 'const node = new ListNode(); node.val = "invalid";');
    expect(
      env.languageService.getSemanticDiagnostics("/main.ts").map((diagnostic) => diagnostic.code),
    ).toContain(2322);
  });
});
