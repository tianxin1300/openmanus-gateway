'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
function sourceOf(start, end) {
  const a = worker.indexOf(start), b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source markers exist: ' + start);
  return worker.slice(a, b);
}
function runFunction(source, name, globals) {
  const sandbox = { ...globals, URL, Date, Math, JSON, Set, Map, Promise, console };
  vm.runInNewContext(source + '\nglobalThis.__tested = ' + name + ';', sandbox);
  return sandbox.__tested;
}
function sourceOfFrontend(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'frontend source markers exist: ' + start);
  return source.slice(a, b);
}

test('ACCEPTANCE BRANCH-01: temp branch creation and edit leave main unchanged', async () => {
  const refs = { main: 'main-commit-001' };
  const create = runFunction(sourceOf('async function codeCreateTempBranch(', 'async function codeMergeTempBranch('), 'codeCreateTempBranch', {
    codeVerifyRef: x => x,
    codeGitRefUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/ref/' + ref,
    codeTempBranch: project => 'code/' + project + '-acceptance-001',
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: refs.main } } };
      if (url.endsWith('/git/refs') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        refs[body.ref.replace('refs/heads/', '')] = body.sha;
        return { ok: true };
      }
      throw new Error('unexpected GitHub call: ' + url);
    }
  });
  const result = await create({}, 'tianxin1300/openmanus-gateway', 'acceptance-001', 'main');
  assert.equal(result.ok, true);
  assert.equal(refs.main, 'main-commit-001');
  assert.equal(refs[result.branch], 'main-commit-001');
  refs[result.branch] = 'temp-commit-002';
  assert.equal(refs.main, 'main-commit-001', 'temp edit must not move main');
  assert.equal(refs[result.branch], 'temp-commit-002');
});

test('ACCEPTANCE MAIN-01: direct main write is rejected by the workbench write guard', async () => {
  const frontend = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const script = /<script\b(?=[^>]*\bid=["']wb-devbench["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(frontend);
  assert.ok(script, 'workbench script exists');
  const putSource = sourceOfFrontend(script[1], 'async function mcpPut(', '\n\nconst WORKBENCH_PROJECTS');
  const put = runFunction(putSource, 'mcpPut', {
    activeBranchRecord: null,
    REPO: { owner: 'tianxin1300', repo: 'openmanus-gateway', branch: 'main' }
  });
  await assert.rejects(() => put('frontend/index.html', 'bad', 'direct-main-write', 'blob'), /已阻止直接写入 main/);
});

test('ACCEPTANCE REVIEW-01: rejected file is absent from the final merge diff', async () => {
  const main = { 'keep.txt': 'main-keep', 'reject.txt': 'base-value' };
  const branch = { ...main, 'keep.txt': 'accepted-value', 'reject.txt': 'rejected-value' };
  const record = { project: 'acceptance', repo: 'tianxin1300/openmanus-gateway', branch: 'code/acceptance-001', baseBranch: 'main', baseCommit: 'base-sha' };
  const history = [];
  let mergedFiles;
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMerge(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'branch-key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: Object.keys(branch).filter(k => branch[k] !== main[k]).map(filename => ({ filename })) } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base-sha' } } };
      throw new Error('unexpected API ' + url);
    },
    codeWorkbenchBranchRejectFile: async (_env, _user, body) => { branch[body.path] = main[body.path]; return { ok: true }; },
    codeMergeTempBranch: async () => { mergedFiles = { ...branch }; Object.assign(main, branch); return { ok: true, data: { sha: 'merged-sha' } }; },
    codeDeleteBranch: async () => ({ ok: true }),
    codeHistoryLoad: async () => history,
    codeHistorySave: async (_env, _user, rows) => { history.splice(0, history.length, ...rows); },
    codeGitRefUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/ref/' + ref,
    codeVerifyRef: x => x
  });
  const env = { KV: { get: async () => record, delete: async () => true, put: async () => {} } };
  const result = await merge(env, 'owner', { repo: record.repo, branch: record.branch, accepted_paths: ['keep.txt'] });
  assert.equal(result.ok, true);
  assert.equal(main['keep.txt'], 'accepted-value');
  assert.equal(main['reject.txt'], 'base-value');
  assert.equal(mergedFiles['reject.txt'], 'base-value');
  assert.deepEqual(Array.from(result.files), ['keep.txt']);
});

test('ACCEPTANCE CONFLICT-01: concurrent same-file edit blocks merge and preserves main', async () => {
  const before = { 'shared.txt': 'person-B-version' }, main = { ...before };
  const record = { project: 'acceptance', repo: 'tianxin1300/openmanus-gateway', branch: 'code/acceptance-conflict', baseBranch: 'main', baseCommit: 'old-base-sha' };
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMerge(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: [{ filename: 'shared.txt' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'new-main-sha' } } };
      throw new Error('unexpected API ' + url);
    },
    codeMergeTempBranch: async () => { main['shared.txt'] = 'silent-overwrite'; return { ok: false, status: 409, msg: 'conflict' }; },
    codeGitRefUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/ref/' + ref,
    codeVerifyRef: x => x
  });
  const result = await merge({ KV: { get: async () => record } }, 'owner', { repo: record.repo, branch: record.branch });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.deepEqual(main, before);
});

test('ACCEPTANCE RETRY-ROLLBACK-01: retry reuses failed run and rollback restores only listed paths', async () => {
  const key = 'verify-key';
  const kvValue = { run_id: '12345', repo: 'tianxin1300/openmanus-gateway', status: 'completed', conclusion: 'failure', retry_count: 0 };
  const retry = runFunction(sourceOf('async function codeRetryRun(', 'async function codeGetFile('), 'codeRetryRun', {
    codeVerifyKey: () => key, codeRepoOk: () => true,
    codeGhApi: async (_env, url, options) => {
      assert.match(url, /\/actions\/runs\/12345\/rerun-failed-jobs$/);
      assert.equal(options.method, 'POST');
      return { ok: true };
    },
    codePersistRun: async (_env, _user, row) => { Object.assign(kvValue, row); return row; }
  });
  const retried = await retry({ KV: { get: async () => kvValue, put: async () => {} } }, 'owner', { run_id: '12345', kind: 'verify' });
  assert.equal(retried.ok, true);
  assert.equal(retried.run_id, '12345');
  assert.equal(retried.retry_count, 1);

  const rows = [{ id: 'history-1', repo: 'tianxin1300/openmanus-gateway', baseBranch: 'main', previous_sha: 'target-commit', files: ['app.js'], summary: 'change app' }];
  let createdCommit, movedRef;
  const rollback = runFunction(sourceOf('async function codeRollback(', 'const CODE_DEPLOY_WORKFLOW'), 'codeRollback', {
    codeHistoryLoad: async () => rows,
    codeHistorySave: async (_env, _user, next) => { rows.splice(0, rows.length, ...next); },
    codeVerifyRef: x => x, codeRepoOk: () => true, codePushGuard: () => '',
    codePathOk: p => typeof p === 'string' && !!p && !p.includes('..') && !p.startsWith('/'),
    codeGitRefUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/ref/' + ref,
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'current-commit' } } };
      if (url.endsWith('/git/commits/current-commit')) return { ok: true, data: { tree: { sha: 'current-tree' } } };
      if (url.endsWith('/git/commits/target-commit')) return { ok: true, data: { tree: { sha: 'target-tree' } } };
      if (url.endsWith('/git/trees/current-tree?recursive=1')) return { ok: true, data: { tree: [
        { type: 'blob', path: 'app.js', sha: 'app-new', mode: '100644' },
        { type: 'blob', path: 'other.js', sha: 'other-current', mode: '100644' }
      ] } };
      if (url.endsWith('/git/trees/target-tree?recursive=1')) return { ok: true, data: { tree: [
        { type: 'blob', path: 'app.js', sha: 'app-old', mode: '100644' },
        { type: 'blob', path: 'other.js', sha: 'other-old', mode: '100644' }
      ] } };
      if (url.endsWith('/git/trees') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body.base_tree, 'current-tree');
        assert.deepEqual(body.tree.map(x => x.path), ['app.js']);
        assert.equal(body.tree[0].sha, 'app-old');
        return { ok: true, data: { sha: 'restored-tree' } };
      }
      if (url.endsWith('/git/commits') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body.parents[0], 'current-commit');
        createdCommit = body;
        return { ok: true, data: { sha: 'rollback-commit' } };
      }
      if (url.endsWith('/git/ref/heads/main') && options.method === 'PATCH') {
        movedRef = JSON.parse(options.body).sha;
        return { ok: true };
      }
      throw new Error('unexpected rollback API ' + url);
    }
  });
  const rolled = await rollback({}, 'owner', { id: 'history-1' });
  assert.equal(rolled.ok, true);
  assert.equal(createdCommit.tree, 'restored-tree');
  assert.equal(createdCommit.parents[0], 'current-commit');
  assert.equal(movedRef, 'rollback-commit');
});
