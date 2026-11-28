'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const studio = fs.readFileSync(path.join(root, 'frontend/studio.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source markers exist: ' + start);
  return source.slice(a, b);
}
function loadRegistry() {
  const source =
    between(worker, 'const codeRepoList =', 'const codePathOk') +
    between(worker, 'const CODE_PROJECTS = [', 'const CODE_EDIT_RE') +
    between(worker, 'function codeProjectRegistry', 'function codeEditRules');
  const sandbox = { Set, String };
  vm.runInNewContext(source + '\nglobalThis.out = { codeRepoList, codeRepoOk, codeProjectRegistry, codeWorkbenchProjectList };', sandbox);
  return sandbox.out;
}

test('P2-PROJECT-001: CODE_REPOS is the sole allowlist; unset means no repositories', () => {
  const { codeRepoList, codeRepoOk } = loadRegistry();
  assert.deepEqual(Array.from(codeRepoList({})), []);
  assert.equal(codeRepoOk({}, 'tianxin1300/openmanus-gateway'), false);
  assert.equal(codeRepoOk({}, 'tianxin1300/jiuyibanlv'), false);
});

test('P2-PROJECT-002: parse only valid owner/repo entries and deduplicate case-insensitively', () => {
  const { codeRepoList, codeRepoOk } = loadRegistry();
  const env = { CODE_REPOS: ' owner/alpha,OWNER/ALPHA, bad value, owner/beta, owner/../escape, /repo, owner/repo/extra ' };
  assert.deepEqual(Array.from(codeRepoList(env)), ['owner/alpha', 'owner/beta']);
  assert.equal(codeRepoOk(env, 'OWNER/ALPHA'), true);
  assert.equal(codeRepoOk(env, 'other/alpha'), false);
});

test('P2-PROJECT-003: project registry contains exactly the allowlisted repositories', () => {
  const { codeProjectRegistry, codeWorkbenchProjectList } = loadRegistry();
  const env = { CODE_REPOS: 'tianxin1300/openmanus-gateway,org/private-app,org/another-app' };
  const registry = codeProjectRegistry(env);
  assert.deepEqual(Array.from(registry, p => p.repo), ['tianxin1300/openmanus-gateway', 'org/private-app', 'org/another-app']);
  assert.deepEqual(Array.from(codeWorkbenchProjectList(env), p => p.repo), Array.from(registry, p => p.repo));
  assert.equal(registry[0].names.includes('聚合体'), true);
  assert.equal(registry[1].repo, 'org/private-app');
  assert.equal(registry[1].owner, 'org');
  assert.equal(registry[1].name, 'private-app');
});

test('P2-PROJECT-004: an unlisted repository cannot be selected by the code assistant', () => {
  const { codeProjectRegistry } = loadRegistry();
  const registry = codeProjectRegistry({ CODE_REPOS: 'owner/allowed' });
  assert.equal(registry.some(p => p.repo === 'owner/denied'), false);
  assert.equal(registry.find(p => p.repo === 'owner/allowed')?.repo, 'owner/allowed');
});

test('P2-PROJECT-005: authenticated project-list endpoint returns only CODE_REPOS entries', () => {
  assert.match(worker, /path === "\/api\/code\/projects" && request\.method === "GET"/);
  assert.match(worker, /source: "CODE_REPOS", projects: codeWorkbenchProjectList\(env\)/);
  assert.match(worker, /if \(!user\) return json\(\{ ok: false, msg: "未登录，token失效" \}, 401\);[\s\S]{0,180}source: "CODE_REPOS"/);
});

test('P2-PROJECT-006: Workbench builds its project selector from the authenticated Worker response', () => {
  assert.match(frontend, /id="wb-project" aria-label="选择项目" disabled/);
  assert.match(frontend, /wbApi\("\/api\/code\/projects"/);
  assert.match(frontend, /WORKBENCH_PROJECTS = Object\.create\(null\)/);
  assert.doesNotMatch(frontend, /<option value="openmanus-gateway">聚合体<\/option>/);
  assert.match(frontend, /if \(!WORKBENCH_PROJECTS\[repo\]\) throw new Error/);
});

test('P2-PROJECT-007: Workbench file reads go through the allowlisted Worker API, not the MCP bypass', () => {
  const getFile = between(frontend, 'async function mcpGet(path)', 'async function mcpPut');
  assert.match(getFile, /\/api\/code\/file\?repo=/);
  assert.match(getFile, /workbenchRepoFull\(\)/);
  assert.match(getFile, /result\.sha/);
  assert.doesNotMatch(getFile, /mcpTools\(|callTool\(/);
  assert.match(worker, /sha: g\.sha \|\| ""/);
});

test('P2-PROJECT-008: code-mode project selector is populated from CODE_REPOS and fails closed', () => {
  assert.match(studio, /api\("\/api\/code\/projects"/);
  assert.match(studio, /PROJECTS = data\.projects\.filter/);
  assert.match(studio, /if \(!PROJECTS\.length\)[\s\S]{0,180}state\.on = false/);
  assert.match(studio, /PROJECTS\.find\(function \(project\) \{ return project\.repo === state\.project \|\| project\.label === state\.project; \}\)/);
});

test('P2-PROJECT-009: no hard-coded fallback allowlist remains in Worker authorization', () => {
  const guard = between(worker, 'const codeRepoList =', 'const codePathOk');
  assert.doesNotMatch(guard, /tianxin1300\/openmanus-gateway,tianxin1300\/jiuyibanlv/);
  assert.match(guard, /String\(env && env\.CODE_REPOS \|\| ""\)/);
});
