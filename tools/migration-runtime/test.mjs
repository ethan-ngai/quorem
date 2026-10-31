/** @file test.mjs @description Exercises the local workerd endpoint. @module migration-runtime */
import assert from 'node:assert/strict';
const base = process.env.SPIKE_URL ?? 'http://127.0.0.1:58731';
const get = async (path) => {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
const result = await get('/');
assert.equal(result.committed[0], result.committed[1]);
assert.equal(result.count, 1);
assert.equal(result.value, 'committed');
assert.equal(result.big, '9223372036854775807');
assert.equal(result.amount, '12345678901234567890.123456789');
assert.equal(result.bytes, '0001ff80');
assert.equal(result.lockCode, '55P03');
assert.equal(result.afterLock, 'released');
const [a, b] = await Promise.all([get('/hold'), get('/hold')]);
assert.notEqual(a.pid, b.pid);
assert.equal((await get('/cleanup')).count, 0);
assert.equal((await fetch(base + '/throw')).status, 500);
assert.equal((await get('/cleanup')).count, 0);
console.log('PASS commit, rollback, pinning, lock timeout, bigint/numeric/bytea, concurrent request isolation, cleanup');
