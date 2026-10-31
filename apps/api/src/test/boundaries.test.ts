/** @file boundaries.test.ts @description Business dependency boundary cases. @module api */
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { boundaryViolations } from '../check-boundaries.ts';

const root = resolve('/api/src');
function violations(entries: Record<string, string>): string[] {
  return boundaryViolations(root, new Map(Object.entries(entries).map(([file, text]) => [resolve(root, file), text])));
}
test('permits business references and explicit pure packages', () => {
  expect(violations({
    'application/command.ts': "import type { Rule } from '../modules/matches/rules.ts'; import { x } from '@quorem/questions'; export { y } from '@quorem/execution/codecs';",
    'modules/matches/rules.ts': "import { z } from '../../application/helper.ts';",
  })).toEqual([]);
});
test('rejects indirect dependencies and transports while scanning all business owners', () => {
  const errors = violations({
    'application/command.ts': "import './helper.ts'; import '../modules/matches/routes.ts';",
    'application/helper.ts': "import type { Pool } from 'pg';",
    'modules/matches/rules.ts': "export * from '../../adapters/db.ts'; import '../../runtime/node.ts'; import '../../http/middleware.ts';",
    'modules/matches/routes.ts': "import { Hono } from 'hono';",
    'modules/matches/rules.test.ts': "import { Hono } from 'hono';",
  });
  expect(errors).toHaveLength(5);
  expect(errors.join('\n')).toContain('application/helper.ts: pg');
  expect(errors.join('\n')).toContain('modules/matches/routes.ts');
});
test('rejects provider packages and dynamic or require indirection', () => {
  const errors = violations({ 'modules/matches/service.ts': `
    import type { Context } from 'hono';
    import { Client } from 'pg';
    import { drizzle } from 'drizzle-orm/node-postgres';
    import type { X } from '@cloudflare/workers-types';
    import { readFile } from 'node:fs';
    import { fake } from '@quorem/questions-evil';
    const loader = require; module.require('pg'); require.resolve('pg');
    import('pg'); import(variable);
    type Hidden = import('node:fs').PathLike;
    module['require']('pg'); globalThis['re' + 'quire']('pg');
  ` });
  expect(errors).toHaveLength(14);
});

test('permits CodeMirror only in the document changes owner', () => {
  const errors = violations({
    'modules/interviews/document/changes.ts': "import { ChangeSet } from '@codemirror/state'; import '@codemirror/view';",
    'modules/interviews/document/other.ts': "import '@codemirror/state';",
  });
  expect(errors).toHaveLength(2);
  expect(errors.join('\n')).toContain('@codemirror/view');
  expect(errors.join('\n')).toContain('other.ts: @codemirror/state');
});
