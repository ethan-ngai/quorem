/** @file worker-check.mjs @description Assert workerd scope cleanup. @module database */
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:58736';
async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
assert.equal((await get('/')).present, 0);
assert.deepEqual(await get('/full'), {assigned:null,closed:true});
assert.equal((await get('/rollback')).count, 0);
assert.equal((await get('/timeout')).kind, 'query_cancelled');
for (const path of ['/error', '/abort']) {
  const result = await get(path);
  assert.ok(result.pid);
  if (path === '/abort') assert.equal(result.kind, 'aborted');
  assert.equal((await get(`/activity?pid=${result.pid}`)).present, 0);
}
console.log('PASS workerd success, rollback, timeout, exception, abort and connection cleanup');
