'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'studio.js'), 'utf8');

function helperHarness() {
  const allowStart = worker.indexOf('const codeRepoList =');
  const allowEnd = worker.indexOf('const CODE_VERIFY_WORKFLOW', allowStart);
  const helperStart = worker.indexOf('function codePendingRepo');
  const helperEnd = worker.indexOf('function codePendingActive', helperStart);
  assert.ok(allowStart >= 0 && allowEnd > allowStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const sandbox = {
    String, Set, Map, JSON,
    codeDeleteBranch: async () => ({ ok: true })
  };
  vm.runInNewContext(
    worker.slice(allowStart, allowEnd) +
    worker.slice(helperStart, helperEnd) +
    '\nglobalThis.api = { codePendingRepo, codeClaimStub };',
    sandbox
  );
  return sandbox.api;
}

function createStorage() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, value); },
    async set(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); },
    async setAlarm() {},
    async transaction(fn) { return fn(this); }
  };
}

function claimClassHarness() {
  const start = worker.indexOf('export class CodeClaimDO');
  const end = worker.indexOf('export class CodeRunnerDO', start);
  assert.ok(start >= 0 && end > start, 'CodeClaimDO definition exists');
  const source = worker.slice(start, end).replace('export class CodeClaimDO', 'class CodeClaimDO');
  const sandbox = {
    Request, Response, URL, Date, JSON, String, Number, Array, Object, Math, Promise, Set, Map,
    CODE_PENDING_TTL_MS: 600000,
    codePendingView: p => p || null,
    codeDeleteBranch: async () => ({ ok: true })
  };
  vm.runInNewContext(source + '\nglobalThis.DO = CodeClaimDO;', sandbox);
  return sandbox.DO;
}

test('P2-PEND-001: Durable Object identity is unique per user and normalized repository', () => {
  const api = helperHarness();
  const names = [];
  const env = {
    CODE_REPOS: 'owner/alpha,owner/beta',
    CODE_CLAIMS: {
      idFromName(name) { names.push(name); return name; },
      get(id) { return { id }; }
    }
  };
  assert.equal(api.codeClaimStub(env, 'user-1', 'Owner/Alpha').id, 'code:user-1:owner/alpha');
  assert.equal(api.codeClaimStub(env, 'user-1', 'owner/beta').id, 'code:user-1:owner/beta');
  assert.equal(api.codeClaimStub(env, 'user-2', 'owner/alpha').id, 'code:user-2:owner/alpha');
  assert.equal(api.codeClaimStub(env, 'user-1', 'owner/denied'), null);
  assert.equal(new Set(names).size, 3);
});

test('P2-PEND-002: two projects keep independent pending records for the same user', async () => {
  const api = helperHarness();
  const DO = claimClassHarness();
  const objects = new Map();
  const env = {
    CODE_REPOS: 'owner/alpha,owner/beta',
    CODE_CLAIMS: {
      idFromName(name) { return name; },
      get(id) {
        if (!objects.has(id)) {
          const storage = createStorage();
          objects.set(id, { instance: new DO({ storage }, env), storage });
        }
        return { fetch: (url, init) => objects.get(id).instance.fetch(new Request(url, init)) };
      }
    }
  };
  const create = async (repo, id) => {
    const stub = api.codeClaimStub(env, 'user-1', repo);
    const response = await stub.fetch('https://code-claims/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, pending: { id, project: repo, repo, branch: 'code/test-' + id, edits: [{ path: 'a.js' }] } })
    });
    return response.json();
  };
  assert.equal((await create('owner/alpha', 'alpha-pending')).ok, true);
  assert.equal((await create('owner/beta', 'beta-pending')).ok, true);
  const alpha = await api.codeClaimStub(env, 'user-1', 'owner/alpha').fetch('https://code-claims/state');
  const beta = await api.codeClaimStub(env, 'user-1', 'owner/beta').fetch('https://code-claims/state');
  assert.equal((await alpha.json()).pending.id, 'alpha-pending');
  assert.equal((await beta.json()).pending.id, 'beta-pending');
  assert.equal(objects.size, 2);
});

test('P2-PEND-003: a repository-scoped claim cannot operate on another repository pending', async () => {
  const api = helperHarness();
  const DO = claimClassHarness();
  const storage = createStorage();
  const instance = new DO({ storage }, {});
  const created = await instance.fetch(new Request('https://code-claims/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'owner/alpha', pending: { id: 'p1', project: 'alpha', repo: 'owner/alpha', branch: 'code/test', edits: [{ path: 'a.js' }] } })
  }));
  assert.equal((await created.json()).ok, true);
  const response = await instance.fetch(new Request('https://code-claims/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'owner/beta', pending_id: 'p1', version: 1, project: 'alpha', operation_id: 'op1', yes: true })
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
  assert.notEqual(api.codeClaimStub({ CODE_REPOS: 'owner/alpha,owner/beta', CODE_CLAIMS: { idFromName: x => x, get: x => ({ id: x }) } }, 'user-1', 'owner/alpha').id,
    api.codeClaimStub({ CODE_REPOS: 'owner/alpha,owner/beta', CODE_CLAIMS: { idFromName: x => x, get: x => ({ id: x }) } }, 'user-1', 'owner/beta').id);
});

test('P2-PEND-004: project creation, replacement cleanup, and confirmation pass the same repository scope', () => {
  const projectStart = worker.indexOf('async function codeProject(');
  const projectEnd = worker.indexOf('async function codeConfirm(', projectStart);
  const project = worker.slice(projectStart, projectEnd);
  assert.match(project, /codePendingLoad\(env, user, scopeRepo\)/);
  assert.match(project, /codePendingDiscard\(env, user, scopeRepo, previous\)/);
  assert.match(project, /codePendingCreate\(env, user, scopeRepo, pending\)/);

  const confirmStart = worker.indexOf('async function codeConfirm(');
  const confirmEnd = worker.indexOf('async function codeChatEntry(', confirmStart);
  const confirm = worker.slice(confirmStart, confirmEnd);
  assert.match(confirm, /codePendingRepo\(env, input\.repo\)/);
  assert.match(confirm, /codeClaimCall\(env, user, scopeRepo, "claim"/);
  assert.match(confirm, /codeClaimCall\(env, user, scopeRepo, "finish"/);
});

test('P2-PEND-005: pending and force-clear APIs require an explicit repository scope', () => {
  assert.match(worker, /codePendingDiscard\(env, user, String\(b\.repo \|\| ""\)\)/);
  assert.match(worker, /codePendingLoad\(env, user, String\(url\.searchParams\.get\("repo"\) \|\| ""\)\)/);
  assert.match(worker, /repo: String\(b\.repo \|\| ""\), pending_id:/);
});

test('P2-PEND-006: active workbench UI sends the selected repository and refreshes after switching', () => {
  assert.match(frontend, /\/api\/code\/pending\?repo=" \+ encodeURIComponent\(state\.project\)/);
  assert.match(frontend, /repo: String\(p\.repo \|\| state\.project\)/);
  assert.match(frontend, /repo: String\(\(currentPending && currentPending\.repo\) \|\| state\.project \|\| ""\)/);
  assert.match(frontend, /currentPending = null; hide\(\); .*refreshPending\(true\)/);
});

test('P2-PEND-007: discard cleanup deletes only the selected repository pending KV key', () => {
  const discardStart = worker.indexOf('async function codePendingDiscard(');
  const discardEnd = worker.indexOf('// v108：cron 扫 KV', discardStart);
  const discard = worker.slice(discardStart, discardEnd);
  assert.match(discard, /env\.KV\.delete\("code:pend:" \+ user \+ ":" \+ scopeRepo\)/);
  assert.doesNotMatch(discard, /env\.KV\.delete\("code:pend:" \+ user\)/);
});
