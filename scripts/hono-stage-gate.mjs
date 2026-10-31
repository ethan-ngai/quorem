/** Fail closed if the staged bundle's entrypoint lacks any native trigger. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
export function checkWorkerEntrypoint(source) {
  const file = ts.createSourceFile(
    "worker.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exported = new Set();
  let handlers;
  for (const node of file.statements) {
    if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression))
      handlers = new Set(
        node.expression.properties.flatMap((p) =>
          (ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p)) &&
          p.name &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
            ? [p.name.text]
            : [],
        ),
      );
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isClassDeclaration(node) && node.name) exported.add(node.name.text);
      if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations)
          if (ts.isIdentifier(d.name)) exported.add(d.name.text);
    }
  }
  for (const name of ["fetch", "scheduled", "queue"])
    if (!handlers?.has(name)) throw new Error(`Worker ${name} handler missing`);
  for (const name of ["BrowserSockets", "DeadlineCoordinator", "ExecutionRecovery"])
    if (!exported.has(name)) throw new Error(`Worker ${name} export missing`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await readFile(
    new URL("../apps/api/src/runtime/worker.ts", import.meta.url),
    "utf8",
  );
  checkWorkerEntrypoint(source);
}
