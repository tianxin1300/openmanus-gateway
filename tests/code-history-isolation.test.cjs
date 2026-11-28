'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'studio.js'), 'utf8');

function harness() {
  const allowStart = worker.indexOf('const codeRepoList =');
  const allowEnd = worker.indexOf('const CODE_VERIFY_WORKFLOW', allowStart);
  const historyStart = worker.indexOf('const codeHistoryKey =');
  const historyEnd = worker.indexOf('const codeWorkbenchBranchKey', historyStart);
  assert.ok(allowStart >= 0 && allowEnd > allowStart);
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  const sandbox = { String, Set, Map, JSON, Array };
  vm.runInNewContext(worker.slice(allowStart, allowEnd) + worker.slice(historyStart, historyEnd) +
    '\nglobalThis.api = { codeHistoryKey, codeHistoryLoad, codeHistorySave };', sandbox);
  return sandbox.api;
}

function kvHarness(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) { return data.has(key) ? data.get(key) : null; },
    async put(key, value) { data.set(key, JSON.parse(value)); }
  };
}

test('P2-HISTORY-001: history keys are isolated by user and normalized repository', () => {
  const api = harness();
  assert.equal(api.codeHistoryKey('user-1', 'Owner/Alpha'), 'code:history:user-1:owner/alpha');
  assert.notEqual(api.codeHistoryKey('user-1', 'owner/alpha'), api.codeHistoryKey('user-1', 'owner/beta'));
  assert.notEqual(api.codeHistoryKey('user-1', 'owner/alpha'), api.codeHistoryKey('user-2', 'owner/alpha'));
});

test('P2-HISTORY-002: saving history for one project never writes another project record', async () => {
  const api = harness(), kv = kvHarness();
  const env = { KV: kv, CODE_REPOS: 'owner/alpha,owner/beta' };
  await api.codeHistorySave(env, 'user-1', 'owner/alpha', [
    { id: 'a1', repo: 'owner/alpha', commit_sha: 'a'.repeat(40) },
    { id: 'b1', repo: 'owner/beta', commit_sha: 'b'.repeat(40) }
  ]);
  assert.deepEqual(kv.data.get(api.codeHistoryKey('user-1', 'owner/alpha')).map(x => x.id), ['a1']);
  assert.equal(kv.data.has(api.codeHistoryKey('user-1', 'owner/beta')), false);
});

test('P2-HISTORY-003: legacy history is migrated only after filtering to the selected repository', async () => {
  const api = harness();
  const legacy = [
    { id: 'a1', repo: 'owner/alpha', commit_sha: 'a'.repeat(40) },
    { id: 'b1', repo: 'owner/beta', commit_sha: 'b'.repeat(40) }
  ];
  const kv = kvHarness({ 'code:history:user-1': legacy });
  const env = { KV: kv, CODE_REPOS: 'owner/alpha,owner/beta' };
  const alpha = await api.codeHistoryLoad(env, 'user-1', 'owner/alpha');
  const beta = await api.codeHistoryLoad(env, 'user-1', 'owner/beta');
  assert.deepEqual(alpha.map(x => x.id), ['a1']);
  assert.deepEqual(beta.map(x => x.id), ['b1']);
  assert.deepEqual(kv.data.get(api.codeHistoryKey('user-1', 'owner/alpha')).map(x => x.id), ['a1']);
  assert.deepEqual(kv.data.get(api.codeHistoryKey('user-1', 'owner/beta')).map(x => x.id), ['b1']);
});

test('P2-HISTORY-004: unauthorized repositories return no history and cannot save', async () => {
  const api = harness(), kv = kvHarness();
  const env = { KV: kv, CODE_REPOS: 'owner/alpha' };
  assert.deepEqual(await api.codeHistoryLoad(env, 'user-1', 'owner/beta'), []);
  await assert.rejects(() => api.codeHistorySave(env, 'user-1', 'owner/beta', [{ id: 'b1', repo: 'owner/beta' }]));
  assert.equal(kv.data.size, 0);
});

test('P2-HISTORY-005: history and rollback frontend requests carry the selected repository', () => {
  assert.match(frontend, /\/api\/code\/history\?repo=" \+ encodeURIComponent\(state\.project\)/);
  assert.match(frontend, /body: JSON\.stringify\(\{ id: h\.id, repo: String\(h\.repo \|\| state\.project\) \}\)/);
  assert.match(worker, /url\.searchParams\.get\("repo"\)/);
  assert.match(worker, /codeHistoryLoad\(env, user, repo\)/);
});
