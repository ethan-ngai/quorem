/** @file node.test.ts @description Node HTTP contract. @module api */
import { serve } from '@hono/node-server';
import { afterAll, beforeAll } from 'vitest';
import { fixture } from './fixture.ts';
import { contract } from './contract.ts';
const server = serve({ fetch: fixture().fetch, hostname: '127.0.0.1', port: 0 });
let port = 0;
beforeAll(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP listener unavailable');
  port = address.port;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
contract((path, init) => fetch(`http://127.0.0.1:${port}${path}`, init));
