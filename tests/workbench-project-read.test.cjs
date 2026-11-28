'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');

function loadFileReader(fetchImpl) {
  const allowlistStart = worker.indexOf('const codeRepoList =');
  const allowlistEnd = worker.indexOf('const CODE_VERIFY_WORKFLOW', allowlistStart);
  const readerStart = worker.indexOf('async function codeGetFile(');
  const readerEnd = worker.indexOf('async function codeFileTree(', readerStart);
  assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart);
  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  const source = worker.slice(allowlistStart, allowlistEnd) + worker.slice(readerStart, readerEnd);
  const sandbox = {
    getKeys: value => String(value || '').split(',').map(item => item.trim()).filter(Boolean),
    Set, Map, String, TextDecoder, Uint8Array, atob,
    fetch: fetchImpl,
    codeGhUrl: (repo, filePath) => 'https://api.github.com/repos/' + repo + '/contents/' + filePath,
    codeGhHeaders: () => ({ Authorization: 'Bearer test-only' }),
    T: () => ({})
  };
  vm.runInNewContext(source + '\nglobalThis.out = { codeGetFile };', sandbox);
  return sandbox.out.codeGetFile;
}

test('P2-READ-001: empty CODE_REPOS rejects file reads before any GitHub request', async () => {
  let calls = 0;
  const read = loadFileReader(async () => { calls++; throw new Error('unexpected GitHub request'); });
  const result = await read({ GH_PAT: 'test-only' }, 'owner/repo', 'README.md', 'main');
  assert.equal(result.ok, false);
  assert.match(result.msg, /不在允许名单/);
  assert.equal(calls, 0);
});

test('P2-READ-002: a repository outside CODE_REPOS is rejected before any GitHub request', async () => {
  let calls = 0;
  const read = loadFileReader(async () => { calls++; throw new Error('unexpected GitHub request'); });
  const result = await read({ GH_PAT: 'test-only', CODE_REPOS: 'owner/allowed' }, 'owner/denied', 'README.md', 'main');
  assert.equal(result.ok, false);
  assert.match(result.msg, /不在允许名单/);
  assert.equal(calls, 0);
});

test('P2-READ-003: an allowlisted file read uses the requested ref and returns SHA plus content', async () => {
  let requestedUrl = '';
  const read = loadFileReader(async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'file', content: 'aGVsbG8=', sha: 'abc123', size: 5 })
    };
  });
  const result = await read({ GH_PAT: 'test-only', CODE_REPOS: 'owner/allowed' }, 'owner/allowed', 'README.md', 'code/task-1');
  assert.equal(requestedUrl, 'https://api.github.com/repos/owner/allowed/contents/README.md?ref=code%2Ftask-1');
  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.sha, 'abc123');
  assert.equal(result.text, 'hello');
});

test('P2-READ-004: Workbench reads use the authenticated Worker file API instead of the MCP read path', () => {
  const start = frontend.indexOf('async function mcpGet(path)');
  const end = frontend.indexOf('async function mcpPut', start);
  assert.ok(start >= 0 && end > start);
  const reader = frontend.slice(start, end);
  assert.match(reader, /\/api\/code\/file\?repo=/);
  assert.match(reader, /workbenchRepoFull\(\)/);
  assert.match(reader, /result\.sha/);
  assert.doesNotMatch(reader, /mcpTools\(|callTool\(/);
  const routeStart = worker.indexOf('if (path === "/api/code/file" && request.method === "GET")');
  const routeEnd = worker.indexOf('if (path === "/api/code/branch/current"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = worker.slice(routeStart, routeEnd);
  assert.ok(route.indexOf('userFromReq(') >= 0 && route.indexOf('userFromReq(') < route.indexOf('codeGetFile('));
});
