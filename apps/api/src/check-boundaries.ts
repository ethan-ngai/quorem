/** @file check-boundaries.ts @description Enforce business-code dependency direction. @module api */
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const purePackages = ['@quorem/questions', '@quorem/execution'] as const;

function protectedPath(root: string, file: string): boolean {
  const path = relative(root, file);
  const parts = path.split(sep);
  if (parts[0] !== 'application' && parts[0] !== 'modules') return false;
  if (parts.some((part) => part === 'test' || part === 'tests' || part === '__tests__')) return false;
  const name = basename(file).replace(/\.(?:[cm]?[jt]sx?)$/, '');
  return name !== 'routes' && !/\.(?:test|spec)$/.test(name);
}

/** Check every protected source, so a business helper cannot hide a provider import. */
export function boundaryViolations(root: string, sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!protectedPath(root, file)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function check(specifier: ts.Expression): void {
      if (!ts.isStringLiteral(specifier)) { violations.push(`${file}: nonliteral import`); return; }
      const name = specifier.text;
      const pure = purePackages.some((pkg) => name === pkg || name.startsWith(`${pkg}/`));
      const relativeBusiness = name.startsWith('.') && !/[?#]/.test(name) && protectedPath(root, resolve(dirname(file), name));
      if (!pure && !relativeBusiness) violations.push(`${file}: ${name}`);
    }
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier);
      if (ts.isImportTypeNode(node)) {
        if (ts.isLiteralTypeNode(node.argument)) check(node.argument.literal);
        else violations.push(`${file}: nonliteral import type`);
      }
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ['module', 'globalThis'].includes(node.expression.text) && (!ts.isStringLiteral(node.argumentExpression) || node.argumentExpression.text === 'require')) violations.push(`${file}: computed runtime access`);
      if (ts.isImportEqualsDeclaration(node)) violations.push(`${file}: import equals`);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push(`${file}: dynamic import`);
      // Reject require references, including aliases and module.require, rather than resolving runtime graphs.
      if (ts.isIdentifier(node) && node.text === 'require') violations.push(`${file}: require`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return violations;
}

async function files(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(resolve(dir, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [resolve(dir, entry.name)] : []))).flat();
}

if (import.meta.main) {
  const paths = (await Promise.all(['application', 'modules'].map((dir) => files(resolve(sourceRoot, dir))))).flat();
  const sources = new Map(await Promise.all(paths.map(async (file) => [file, await readFile(file, 'utf8')] as const)));
  const violations = boundaryViolations(sourceRoot, sources);
  for (const violation of violations) console.error(`Business import boundary: ${violation}`);
  if (violations.length) process.exitCode = 1;
}
