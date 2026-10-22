/** @file Browser compiler environment using bundled libraries; no CDN or source uploads. */
import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import ts from "typescript";

const libraries = import.meta.glob("../../../node_modules/typescript/lib/lib.*.d.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Match the public node types supplied by the judge, without exposing its harness. */
export function createBrowserTypeScriptEnvironment() {
  const files = new Map(
    Object.entries(libraries).map(([path, source]) => [path.slice(path.lastIndexOf("/")), source]),
  );
  files.set(
    "/quorem.d.ts",
    `
    declare class ListNode {
      constructor(val?: number, next?: ListNode | null);
      val: number;
      next: ListNode | null;
    }
    declare class TreeNode {
      constructor(val?: number, left?: TreeNode | null, right?: TreeNode | null);
      val: number;
      left: TreeNode | null;
      right: TreeNode | null;
    }
  `,
  );
  return createVirtualTypeScriptEnvironment(createSystem(files), ["/quorem.d.ts"], ts, {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
  });
}
