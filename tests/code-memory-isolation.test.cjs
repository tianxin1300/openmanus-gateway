'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');

function createMemoryHarness() {
  const allowStart = worker.indexOf('const codeRepoList =');
  const allowEnd = worker.indexOf('const CODE_VERIFY_WORKFLOW', allowStart);
  const memoryStart = worker.indexOf('const codeMemoryKey =');
  const memoryEnd = worker.indexOf('async function codeRollbackUnlocked', memoryStart);
  assert.ok(allowStart >= 0 && allowEnd > allowStart, 'CODE_REPOS authorization helpers exist');
  assert.ok(memoryStart >= 0 && memoryEnd > memoryStart, 'repository-scoped memory helpers exist');

  const data = new Map();
  const writes = [];
  const env = {
    CODE_REPOS: 'owner/alpha,owner/beta',
    CODE_PUSH_BRANCH: 'main',
    KV: {
      get: async key => data.has(key) ? JSON.parse(data.get(key)) : null,
      put: async (key, value, options) => {
        data.set(key, value);
        writes.push({ key, options });
      }
    }
  };
  const sandbox = {
    Set, Map, String, Date, Math, JSON, encodeURIComponent,
    codeGhApi: async () => ({ ok: true, data: [] })
  };
  vm.runInNewContext(
    worker.slice(allowStart, allowEnd) +
    worker.slice(memoryStart, memoryEnd) +
    '\nglobalThis.api = { codeMemoryKey, codeMemoryLoad, codeMemorySave, codeMemoryAppend, codeMemoryPrompt };',
    sandbox
  );
  return { api: sandbox.api, env, data, writes };
}

test('P2-MEM-001: memory keys are scoped by user and normalized repository', () => {
  const { api } = createMemoryHarness();
  assert.equal(api.codeMemoryKey('user-1', 'Owner/Alpha'), 'code:memory:user-1:owner/alpha');
  assert.notEqual(api.codeMemoryKey('user-1', 'owner/alpha'), api.codeMemoryKey('user-1', 'owner/beta'));
  assert.notEqual(api.codeMemoryKey('user-1', 'owner/alpha'), api.codeMemoryKey('user-2', 'owner/alpha'));
});

test('P2-MEM-002: alpha project memory is never injected into beta project prompt', async () => {
  const { api, env, writes } = createMemoryHarness();
  await api.codeMemoryAppend(env, 'user-1', 'owner/alpha', { action: '用户', text: 'ALPHA_PRIVATE_CONTEXT' });
  await api.codeMemoryAppend(env, 'user-1', 'owner/beta', { action: '用户', text: 'BETA_CONTEXT' });
  const alpha = await api.codeMemoryPrompt(env, 'user-1', 'owner/alpha');
  const beta = await api.codeMemoryPrompt(env, 'user-1', 'owner/beta');
  assert.match(alpha, /ALPHA_PRIVATE_CONTEXT/);
  assert.doesNotMatch(alpha, /BETA_CONTEXT/);
  assert.match(beta, /BETA_CONTEXT/);
  assert.doesNotMatch(beta, /ALPHA_PRIVATE_CONTEXT/);
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].key, writes[1].key);
});

test('P2-MEM-003: memory is also isolated between users within the same repository', async () => {
  const { api, env } = createMemoryHarness();
  await api.codeMemoryAppend(env, 'user-1', 'owner/alpha', { text: 'USER_ONE_ONLY' });
  const otherUser = await api.codeMemoryPrompt(env, 'user-2', 'owner/alpha');
  assert.doesNotMatch(otherUser, /USER_ONE_ONLY/);
});

test('P2-MEM-004: repositories outside CODE_REPOS cannot read or write project memory', async () => {
  const { api, env, writes } = createMemoryHarness();
  const result = await api.codeMemoryAppend(env, 'user-1', 'owner/denied', { text: 'DENIED_CONTEXT' });
  const prompt = await api.codeMemoryPrompt(env, 'user-1', 'owner/denied');
  assert.equal(result, null);
  assert.doesNotMatch(prompt, /DENIED_CONTEXT/);
  assert.equal(writes.length, 0);
});

test('P2-MEM-005: each repository keeps its own newest 20 memory entries', async () => {
  const { api, env } = createMemoryHarness();
  for (let i = 1; i <= 22; i++) {
    await api.codeMemoryAppend(env, 'user-1', 'owner/alpha', { text: 'ALPHA_ENTRY_' + i });
  }
  const alpha = await api.codeMemoryPrompt(env, 'user-1', 'owner/alpha');
  assert.match(alpha, /ALPHA_ENTRY_22/);
  assert.match(alpha, /ALPHA_ENTRY_3/);
  assert.doesNotMatch(alpha, /ALPHA_ENTRY_2(?:\D|$)/);
  const beta = await api.codeMemoryPrompt(env, 'user-1', 'owner/beta');
  assert.doesNotMatch(beta, /ALPHA_ENTRY_/);
});

test('P2-MEM-006: code-assist routes confirmation, user and AI memory through the resolved project repository', () => {
  const start = worker.indexOf('async function codeAssist(env, user, raw, history)');
  const end = worker.indexOf('const CODE_PROJECTS =', start);
  assert.ok(start >= 0 && end > start);
  const codeAssist = worker.slice(start, end);
  assert.match(codeAssist, /const memRepo = d\.repo \|\| String\(env\.CODE_REPOS/);
  assert.match(codeAssist, /codeMemoryPrompt\(env, user, memRepo\)/);
  assert.equal((codeAssist.match(/codeMemoryAppend\(env, user, memRepo,/g) || []).length, 3);
  assert.doesNotMatch(codeAssist, /codeMemoryAppend\(env, user, \{/);
});

test('P2-MEM-007: project chat memory no longer reads or writes the shared workbench history key', () => {
  const start = worker.indexOf('const codeMemoryKey =');
  const end = worker.indexOf('async function codeRollbackUnlocked', start);
  const memory = worker.slice(start, end);
  assert.match(memory, /code:memory:/);
  assert.match(memory, /codeMemoryLoad\(env, user, repo\)/);
  assert.match(memory, /codeMemorySave\(env, user, repo,/);
  assert.doesNotMatch(memory, /codeHistoryLoad|codeHistorySave/);
});
