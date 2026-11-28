'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
function sourceOf(start, end) {
  const a = worker.indexOf(start), b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source markers exist: ' + start);
  return worker.slice(a, b);
}
function loadRunFunctions() {
  const keys = sourceOf('const codeRunLogKey =', 'function codeRunnerNamespace');
  const functions = sourceOf('async function codeRunIndexLoad', 'async function codeWorkflowStatus');
  const sandbox = {
    URL, Date, Math, JSON, Promise,
    codeRepoOk: (env, repo) => String(env.CODE_REPOS || '').split(',').map(x => x.trim().toLowerCase()).includes(String(repo || '').trim().toLowerCase()),
    codeRunnerUpdate: async () => ({ ok: true })
  };
  vm.runInNewContext(keys + '\n' + functions + '\nglobalThis.out = { codeRunLogKey, codeRunIndexKey, codeRunIndexLoad, codeRunIndexSummary, codeRunIndexSave, codePersistRun, codeRunLogs, codeRuns };', sandbox);
  return sandbox.out;
}
function makeEnv() {
  const data = new Map();
  return {
    CODE_REPOS: 'owner/alpha,owner/beta',
    KV: {
      async get(key, type) {
        const value = data.get(key);
        if (value === undefined) return null;
        if (type === 'json') { try { return JSON.parse(value); } catch { return null; } }
        return value;
      },
      async put(key, value) { data.set(key, String(value)); },
      async delete(key) { data.delete(key); }
    },
    data
  };
}
const run = (repo, branch, extra = {}) => ({
  request_id: 'task-' + repo.split('/')[1], run_id: '812345',
  task_id: 'task-' + repo.split('/')[1], project: repo, repo, ref: branch,
  kind: 'verify', workflow: 'verify-project.yml', status: 'completed',
  conclusion: 'success', state: 'success', head_sha: 'a'.repeat(40),
  run_url: 'https://github.com/' + repo + '/actions/runs/812345',
  started_at: '2026-11-29T00:00:00.000Z', ...extra
});
test('RUN-ISOLATION-01: same user indexes are isolated by authorized repository', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await f.codePersistRun(env, 'user-1', run('owner/alpha', 'feature/alpha'));
  await f.codePersistRun(env, 'user-1', run('owner/beta', 'feature/beta'));
  const a = await f.codeRuns(env, 'user-1', 'owner/alpha');
  const b = await f.codeRuns(env, 'user-1', 'owner/beta');
  assert.deepEqual(Array.from(a.runs, x => x.repo), ['owner/alpha']);
  assert.deepEqual(Array.from(b.runs, x => x.repo), ['owner/beta']);
  assert.notEqual(f.codeRunIndexKey('user-1', 'owner/alpha'), f.codeRunIndexKey('user-1', 'owner/beta'));
});
test('RUN-ISOLATION-02: summary retains project, branch, commit, task and Actions lineage', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  const record = run('owner/alpha', 'feature/alpha', { runs: [
    { kind: 'deploy', run_id: '812345', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success', state: 'success', run_url: 'https://github.com/run/812345' },
    { kind: 'worker', run_id: '812346', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'failure', state: 'failure', run_url: 'https://github.com/run/812346' }
  ], retry_count: 2 });
  await f.codePersistRun(env, 'user-1', record);
  const { runs } = await f.codeRuns(env, 'user-1', 'owner/alpha');
  assert.equal(runs[0].project, 'owner/alpha');
  assert.equal(runs[0].repo, 'owner/alpha');
  assert.equal(runs[0].branch, 'feature/alpha');
  assert.equal(runs[0].head_sha, 'a'.repeat(40));
  assert.equal(runs[0].task_id, 'task-alpha');
  assert.equal(runs[0].actions_run_id, '812345');
  assert.deepEqual(Array.from(runs[0].actions_run_ids), ['812345', '812346']);
  assert.deepEqual(Array.from(runs[0].head_shas), ['b'.repeat(40), 'c'.repeat(40)]);
  assert.equal(runs[0].retry_count, 2);
  assert.deepEqual(Array.from(runs[0].child_runs, x => ({
    kind: x.kind, run_id: x.run_id, status: x.status, conclusion: x.conclusion,
    state: x.state, run_url: x.run_url
  })), [
    { kind: 'deploy', run_id: '812345', status: 'completed', conclusion: 'success', state: 'success', run_url: 'https://github.com/run/812345' },
    { kind: 'worker', run_id: '812346', status: 'completed', conclusion: 'failure', state: 'failure', run_url: 'https://github.com/run/812346' }
  ]);
});
test('RUN-ISOLATION-03: same Actions run ID in two repositories cannot collide in log storage', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await f.codePersistRun(env, 'user-1', run('owner/alpha', 'feature/alpha', { logs: ['alpha'] }));
  await f.codePersistRun(env, 'user-1', run('owner/beta', 'feature/beta', { logs: ['beta'] }));
  const a = await f.codeRunLogs(env, 'user-1', 'owner/alpha', '812345');
  const b = await f.codeRunLogs(env, 'user-1', 'owner/beta', '812345');
  assert.deepEqual(Array.from(a.logs), ['alpha']);
  assert.deepEqual(Array.from(b.logs), ['beta']);
  assert.notEqual(a.log_key, b.log_key);
});
test("RUN-ISOLATION-09: same repository and Actions run ID cannot collide across users", async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await f.codePersistRun(env, "user-1", run("owner/alpha", "feature/alpha", { logs: ["user-1"] }));
  await f.codePersistRun(env, "user-2", run("owner/alpha", "feature/alpha", { logs: ["user-2"] }));
  const one = await f.codeRunLogs(env, "user-1", "owner/alpha", "812345");
  const two = await f.codeRunLogs(env, "user-2", "owner/alpha", "812345");
  assert.deepEqual(Array.from(one.logs), ["user-1"]);
  assert.deepEqual(Array.from(two.logs), ["user-2"]);
  assert.notEqual(one.log_key, two.log_key);
});
test("RUN-ISOLATION-10: short commit SHA is not mislabeled as a branch or full head SHA", async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await f.codePersistRun(env, "user-1", run("owner/alpha", "abcdef1234567", { head_sha: "" }));
  const { runs } = await f.codeRuns(env, "user-1", "owner/alpha");
  assert.equal(runs[0].branch, "");
  assert.equal(runs[0].head_sha, "");
});
test('RUN-ISOLATION-04: cross-repository log reads are rejected', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await f.codePersistRun(env, 'user-1', run('owner/alpha', 'feature/alpha'));
  const result = await f.codeRunLogs(env, 'user-1', 'owner/beta', '812345');
  assert.equal(result.ok, false);
});
test('RUN-ISOLATION-05: unauthorized repositories cannot list or read logs', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  const list = await f.codeRuns(env, 'user-1', 'owner/secret');
  const logs = await f.codeRunLogs(env, 'user-1', 'owner/secret', '812345');
  assert.equal(list.ok, false);
  assert.equal(logs.ok, false);
});
test('RUN-ISOLATION-06: legacy user-only index and repo-less log are not attributed to a project', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  await env.KV.put('code:runs:user-1', JSON.stringify([{ run_id: 'legacy-1', request_id: 'legacy-1' }]));
  await env.KV.put('log:run:legacy-1', JSON.stringify({ ok: true, owner_user: 'user-1', logs: ['legacy'] }));
  const list = await f.codeRuns(env, 'user-1', 'owner/alpha');
  const logs = await f.codeRunLogs(env, 'user-1', 'owner/alpha', 'legacy-1');
  assert.equal(list.runs.length, 0);
  assert.equal(logs.ok, false);
});
test('RUN-ISOLATION-07: repo-less records are not persisted into a guessed project scope', async () => {
  const f = loadRunFunctions(), env = makeEnv();
  const record = { request_id: 'old-task', run_id: 'old-task', status: 'completed' };
  await f.codePersistRun(env, 'user-1', record);
  assert.equal(env.data.has(f.codeRunIndexKey('user-1', 'owner/alpha')), false);
  assert.equal(env.data.has(f.codeRunIndexKey('user-1', 'owner/beta')), false);
});
test('RUN-ISOLATION-08: Durable Object watcher uses the same repo-scoped index writer', () => {
  assert.match(worker, /await codeRunIndexSave\(this\.env, user, record\)/);
  assert.match(worker, /codeRunLogKey\(runId, user, record\.repo\)/);
});
