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
    declare class ListNode<T = number> {
      constructor(val?: T, next?: ListNode<T> | null);
      val: T;
      next: ListNode<T> | null;
    }
    declare class TreeNode<T = number> {
      constructor(val?: T, left?: TreeNode<T> | null, right?: TreeNode<T> | null);
      val: T;
      left: TreeNode<T> | null;
      right: TreeNode<T> | null;
    }
  `,
  );
  return createVirtualTypeScriptEnvironment(createSystem(files), ["/quorem.d.ts"], ts, {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
  });
}
