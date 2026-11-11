/** @file Browser compiler environment using bundled libraries; no CDN or source uploads. */
import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import ts from "typescript";
import automaticImports from "../../../../../internal/execution/public/automatic_imports.json";

const libraries = import.meta.glob("../../../node_modules/typescript/lib/lib.*.d.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Match the public node types supplied by the judge, without exposing its harness. */
export function createBrowserTypeScriptEnvironment(useAutomaticImports = false) {
  const files = new Map(
    Object.entries(libraries).map(([path, source]) => [path.slice(path.lastIndexOf("/")), source]),
  );
  const commonGlobals = useAutomaticImports
    ? Object.entries(automaticImports.typescript)
        .map(([name, entry]) => `declare var ${name}: ${entry.type};`)
        .join("\n")
    : "";
  files.set(
    "/quorem.d.ts",
    `
    ${commonGlobals}
    declare class ListNode<T = number> {
      constructor(val?: T, next?: ListNode<T> | null);
      val: T;
      next: ListNode<T> | null;
    }
    declare class NaryTreeNode<T = number> {
      constructor(val?: T, children?: NaryTreeNode<T>[]);
      val: T;
      children: NaryTreeNode<T>[];
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
    ...(useAutomaticImports ? { moduleDetection: ts.ModuleDetectionKind.Force } : {}),
    noEmit: true,
  });
}
