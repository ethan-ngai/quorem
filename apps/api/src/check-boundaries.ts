/** @file check-boundaries.ts @description Enforce application import direction. @module api */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'application');
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(resolve(dir, entry.name)) : entry.name.endsWith('.ts') ? [resolve(dir, entry.name)] : []))).flat();
}
let failed = false;
for (const file of await files(root)) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
    if (specifier) {
      const allowed = ts.isStringLiteral(specifier) && specifier.text.startsWith('.') && resolve(dirname(file), specifier.text).startsWith(root + sep);
      if (!allowed) { console.error(`Application import boundary: ${file}: ${specifier.getText(source)}`); failed = true; }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failed) process.exitCode = 1;
