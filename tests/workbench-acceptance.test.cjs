'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
function sourceOf(start, end) {
  const a = worker.indexOf(start), b = worker.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'source markers exist: ' + start);
  return worker.slice(a, b);
}
function runFunction(source, name, globals) {
  const sandbox = { ...globals, URL, Date, Math, JSON, Set, Map, Promise, AbortController, AbortSignal, console, codeWorkbenchLocalLockControllers: globals.codeWorkbenchLocalLockControllers || new Map(), setInterval: globals.setInterval || setInterval, clearInterval: globals.clearInterval || clearInterval, crypto: globals.crypto || require('node:crypto').webcrypto, codeGitRefWriteUrl: globals.codeGitRefWriteUrl || ((repo, ref) => 'https://api.github.com/repos/' + repo + '/git/refs/' + String(ref).split('/').map(encodeURIComponent).join('/')), codeWorkbenchWithLock: globals.codeWorkbenchWithLock || (async (_env, _user, _repo, _operation, run) => run()) };
  vm.runInNewContext(source + '\nglobalThis.__tested = ' + name + ';', sandbox);
  return sandbox.__tested;
}
function sourceOfFrontend(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'frontend source markers exist: ' + start);
  return source.slice(a, b);
}

function makeRejectHarness(overrides = {}) {
  const stats = { reads: 0, writes: 0, audits: 0 };
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchRejectFile('), 'codeWorkbenchBranchRejectFileUnlocked', {
    codeRepoOk: () => true,
    codePathOk: p => typeof p === 'string' && !!p && !p.startsWith('/') && !p.includes('..'),
    codePushGuard: () => '',
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/review', baseCommit: 'base-sha' }),
    codeWorkbenchBranchKey: () => 'review-key',
    codeGetFile: async (_env, _repo, _path, ref) => { stats.reads++; return { ok: true, exists: true, text: ref === 'base-sha' ? 'base' : 'edited', sha: 'blob-sha' }; },
    codeUpdateFile: async () => { stats.writes++; return { ok: true }; },
    codeGhUrl: (_repo, path) => 'https://api.github.com/contents/' + path,
    codeGhApi: async () => { stats.writes++; return { ok: true }; },
    ...overrides
  });
  const env = { KV: { get: async () => ({ review_events: [] }), put: async () => { stats.audits++; } } };
  return { reject, env, stats };
}

function makeMergeHarness(options = {}) {
  const state = {
    record: { project: 'p', repo: 'owner/repo', branch: 'code/p', baseBranch: 'main', baseCommit: 'base-sha', status: 'active' },
    history: [], mergeCalls: 0, deleteCalls: 0, kvDeleteCalls: 0
  };
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeWorkbenchBranchMerge('), 'codeWorkbenchBranchMergeUnlocked', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'branch-key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: [{ filename: 'app.js' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base-sha' } } };
      if (url.includes('/heads/code/')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected merge API ' + url);
    },
    codeGitRefUrl: (_repo, ref) => 'https://api.github.com/repos/owner/repo/git/ref/' + ref,
    codeMergeTempBranch: async () => { state.mergeCalls++; return { ok: true, data: { sha: 'merged-sha' } }; },
    codeHistoryLoad: async () => state.history,
    codeHistorySave: async (_env, _user, rows) => { state.history = rows; },
    codeDeleteBranch: async () => { state.deleteCalls++; return { ok: true }; },
    ...options.globals
  });
  const env = { KV: {
    get: async () => state.record,
    put: async (_key, value) => { state.record = JSON.parse(value); },
    delete: async () => { state.kvDeleteCalls++; state.record = null; }
  } };
  if (options.kvDelete) env.KV.delete = options.kvDelete;
  return { merge, env, state };
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
  await assert.rejects(() => put('frontend/index.html', 'bad', 'direct-main-write', 'blob'), /当前分支不可保存/);
});

test('ACCEPTANCE REVIEW-01: rejected file is absent from the final merge diff', async () => {
  const main = { 'keep.txt': 'main-keep', 'reject.txt': 'base-value' };
  const branch = { ...main, 'keep.txt': 'accepted-value', 'reject.txt': 'rejected-value' };
  const record = { project: 'acceptance', repo: 'tianxin1300/openmanus-gateway', branch: 'code/acceptance-001', baseBranch: 'main', baseCommit: 'base-sha' };
  const history = [];
  let mergedFiles;
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'branch-key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: Object.keys(branch).filter(k => branch[k] !== main[k]).map(filename => ({ filename })) } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base-sha' } } };
      if (url.includes('/heads/code/')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected API ' + url);
    },
    codeWorkbenchBranchRejectFileUnlocked: async (_env, _user, body) => { branch[body.path] = main[body.path]; return { ok: true }; },
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
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
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
  const rollback = runFunction(sourceOf('async function codeRollbackUnlocked(', 'const CODE_DEPLOY_WORKFLOW'), 'codeRollback', {
    codeHistoryLoad: async () => rows,
    codeHistorySave: async (_env, _user, _repo, next) => { rows.splice(0, rows.length, ...next); },
    codeVerifyRef: x => x, codeRepoOk: () => true, codePushGuard: () => '',
    codeWorkbenchWithLock: async (_env, _user, _repo, operation, run) => { assert.equal(operation, 'rollback'); return run(); },
    codePathOk: p => typeof p === 'string' && !!p && !p.includes('..') && !p.startsWith('/'),
    codeGitRefUrl: (repo, ref) => 'https://api.github.com/repos/' + repo + '/git/ref/' + ref,
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main') && options.method !== 'PATCH') return { ok: true, data: { object: { sha: 'current-commit' } } };
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
      if (url.endsWith('/git/refs/heads/main') && options.method === 'PATCH') {
        movedRef = JSON.parse(options.body).sha;
        return { ok: true };
      }
      throw new Error('unexpected rollback API ' + url);
    }
  });
  const rolled = await rollback({}, 'owner', { repo: 'tianxin1300/openmanus-gateway', id: 'history-1' });
  assert.equal(rolled.ok, true, JSON.stringify(rolled));
  assert.equal(createdCommit.tree, 'restored-tree');
  assert.equal(createdCommit.parents[0], 'current-commit');
  assert.equal(movedRef, 'rollback-commit');
  assert.equal(rolled.actor, 'owner', 'rollback history records the authenticated actor');
});
  
test('ACCEPTANCE WORKBENCH-PREVIEW-AUDIT-01: preview dispatch records the authenticated actor', async () => {
  const record = { ok: true, repo: 'tianxin1300/openmanus-gateway', branch: 'code/preview', baseBranch: 'main', active: true };
  const preview = runFunction(sourceOf('async function codeWorkbenchBranchPreviewUnlocked(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchPreviewUnlocked', {
    codePushGuard: () => '',
    codePreviewConfig: () => ({ mode: 'pages' }),
    codeWorkbenchBranchCurrent: async () => record,
    codeTempPreview: () => 'https://preview.example.test',
    rand: () => 'abcdef12',
    codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async () => ({ ok: true }),
  });
  const env = { KV: { put: async (_key, value) => Object.assign(record, JSON.parse(value)) } };
  const result = await preview(env, 'owner', 'tianxin1300/openmanus-gateway');
  assert.equal(result.ok, true);
  assert.equal(record.preview_started_by, 'owner');
  assert.equal(record.preview_events[0].actor, 'owner');
  assert.equal(record.preview_url, '');
  assert.equal(record.preview_status, 'pending');
  assert.ok(record.preview_request_id);
});



test('ACCEPTANCE WORKBENCH-PAGES-PREVIEW-01: Pages preview is pending until its matching Actions run succeeds', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  const record = { repo, branch: 'code/pages-preview', preview_mode: 'pages', preview_request_id: 'request-pages-12345678', preview_status: 'pending' };
  const refresh = runFunction(sourceOf('async function codeWorkbenchPagesPreviewRefresh(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchPagesPreviewRefresh', {
    codeGhApi: async (_env, url) => {
      assert.match(url, /actions\/runs\?branch=code%2Fpages-preview&event=workflow_dispatch/);
      return { ok: true, data: { workflow_runs: [{
        id: 8801, name: 'branch preview', display_title: 'branch preview · code/pages-preview · request-pages-12345678',
        status: 'completed', conclusion: 'success', html_url: 'https://github.com/tianxin1300/openmanus-gateway/actions/runs/8801'
      }] } };
    },
    codeTempPreview: () => 'https://code-pages-preview.zhineng-et5.pages.dev'
  });
  const result = await refresh({}, record);
  assert.equal(result.ok, true);
  assert.equal(record.preview_status, 'ready');
  assert.equal(record.preview_url, 'https://code-pages-preview.zhineng-et5.pages.dev');
  assert.equal(record.preview_run_id, '8801');
});

test('ACCEPTANCE WORKBENCH-PAGES-PREVIEW-02: failed Pages workflow never exposes a preview URL', async () => {
  const record = { repo: 'tianxin1300/openmanus-gateway', branch: 'code/pages-preview', preview_mode: 'pages', preview_request_id: 'request-pages-12345678', preview_status: 'pending' };
  const refresh = runFunction(sourceOf('async function codeWorkbenchPagesPreviewRefresh(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchPagesPreviewRefresh', {
    codeGhApi: async () => ({ ok: true, data: { workflow_runs: [{
      id: 8802, display_title: 'branch preview · request-pages-12345678', status: 'completed', conclusion: 'failure'
    }] } }),
    codeTempPreview: () => 'https://code-pages-preview.zhineng-et5.pages.dev'
  });
  await refresh({}, record);
  assert.equal(record.preview_status, 'failed');
  assert.equal(record.preview_url, '');
  assert.match(record.preview_error, /workflow 失败/);
});


test('ACCEPTANCE WORKBENCH-PREVIEW-SCOPE-01: Workbench only exposes this repository Pages preview', () => {
  const previewConfig = runFunction(sourceOf('const codePreviewConfig = (repo) =>', 'async function codeWorkbenchPagesPreviewRefresh'), 'codePreviewConfig', {});
  const config = previewConfig('tianxin1300/openmanus-gateway');
  assert.equal(config.mode, 'pages');
  assert.equal(config.workflow_repo, 'tianxin1300/openmanus-gateway');
  assert.equal(config.workflow_file, 'deploy-branch-preview.yml');
  assert.equal(previewConfig('owner-b/second-project'), null);
  assert.doesNotMatch(worker, /codeWorkbenchWorkerPreview/);
  assert.doesNotMatch(frontend, /preview_mode === "worker"|Worker 预览|Worker Preview/);
});


test('ACCEPTANCE WORKBENCH-PAGES-PREVIEW-03: Pages workflow verifies the same bounded branch alias exposed by Workbench', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-branch-preview.yml'), 'utf8');
  assert.match(workflow, /github\.event\.inputs\.request_id/);
  assert.match(workflow, /slug\.slice|strip\("-"\)\[:28\]/);
  assert.match(workflow, /zhineng-et5\.pages\.dev/);
  assert.match(workflow, /Verify preview HTTP 200 with curl/);
  assert.match(workflow, /Verify preview opens with Playwright/);
  assert.match(workflow, /Take a peek over at/);
});


test('ACCEPTANCE WORKBENCH-SAVE-CAS-01: editor saves share the repository lock and reject stale file SHA', async () => {
  let currentSha = 'a'.repeat(40), writes = 0;
  const lockOperations = [];
  const save = runFunction(sourceOf('async function codeWorkbenchBranchSaveFileUnlocked(', 'async function codeWorkbenchBranchPreviewUnlocked('), 'codeWorkbenchBranchSaveFile', {
    codeWorkbenchWithLock: async (_env, _user, _repo, operation, run) => {
      lockOperations.push(operation);
      return run();
    },
    codeRepoOk: () => true,
    codePathOk: () => true,
    codePushGuard: () => '',
    codeWorkbenchBranchKey: () => 'key',
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/save-test' }),
    codeGetFile: async () => ({ ok: true, exists: true, sha: currentSha }),
    codeUpdateFile: async (_env, _repo, _path, _content, _message, _branch, sha) => {
      assert.equal(sha, currentSha);
      writes++;
      currentSha = 'b'.repeat(40);
      return { ok: true, url: 'https://github.com/owner/repo/commit/save' };
    }
  });
  const auditRecord = { branch: 'code/save-test' };
  const env = { KV: { get: async () => auditRecord, put: async (_key, value) => Object.assign(auditRecord, JSON.parse(value)) } };
  const stale = await save(env, 'owner', { repo: 'owner/repo', branch: 'code/save-test', path: 'app.js', content: 'stale', sha: 'c'.repeat(40) });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(writes, 0, 'stale editor state must not write to GitHub');

  const saved = await save(env, 'owner', { repo: 'owner/repo', branch: 'code/save-test', path: 'app.js', content: 'fresh', sha: 'a'.repeat(40) });
  assert.equal(saved.ok, true);
  assert.equal(saved.sha, 'b'.repeat(40));
  assert.equal(writes, 1);
  assert.equal(auditRecord.last_saved_by, 'owner');
  assert.equal(auditRecord.save_events[0].actor, 'owner');
  assert.deepEqual(lockOperations, ['save', 'save']);

  const put = sourceOfFrontend(frontend, 'async function mcpPut(', 'const WORKBENCH_PROJECTS =');
  assert.match(put, /\/api\/code\/branch\/save-file/);
  assert.match(put, /sha/);
});

test('ACCEPTANCE WORKBENCH-ROLLBACK-LOCK-01: history rollback acquires the repository write lock', async () => {
  const calls = [];
  const rollback = runFunction(sourceOf('async function codeRollbackUnlocked(', 'const CODE_DEPLOY_WORKFLOW'), 'codeRollback', {
    codeHistoryLoad: async () => [{ id: 'history-locked', repo: 'owner/repo', previous_sha: 'previous' }],
    codeRepoOk: () => true,
    codeWorkbenchWithLock: async (_env, user, repo, operation, run) => {
      calls.push({ user, repo, operation });
      return { ok: true, locked: true };
    }
  });
  const result = await rollback({}, 'owner', { repo: 'owner/repo', id: 'history-locked' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.locked, true);
  assert.deepEqual(calls, [{ user: 'owner', repo: 'owner/repo', operation: 'rollback' }]);
});

test('ACCEPTANCE WORKBENCH-RENAME-DIFF-01: branch diff preserves the previous filename for UI rejection', async () => {
  const diff = runFunction(sourceOf('async function codeWorkbenchBranchDiff(', 'async function codeWorkbenchBranchRejectFileUnlocked('), 'codeWorkbenchBranchDiff', {
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/rename', baseBranch: 'main' }),
    codeGhApi: async () => ({ ok: true, data: { files: [
      { filename: 'new-name.js', previous_filename: 'old-name.js', status: 'renamed', additions: 1, deletions: 1, patch: '@@ rename' }
    ] } })
  });
  const result = await diff({}, 'owner', 'owner/repo');
  assert.equal(result.ok, true);
  assert.equal(result.files[0].path, 'new-name.js');
  assert.equal(result.files[0].previous_path, 'old-name.js');
});



test('ACCEPTANCE PERMISSION-01: unauthorized identities cannot create, save, review, merge, discard, preview, or roll back; authorized actions are attributed', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  const guard = runFunction(sourceOf('function codePushGuard(', 'function codeParse('), 'codePushGuard', {
    codeRepoOk: () => true, codePathOk: () => true, codePathProtected: () => false
  });
  const env = { GH_PAT: 'test-token', CODE_OWNER: 'owner', CODE_REPOS: repo, KV: {
    get: async () => ({ branch: 'code/owned', repo, baseCommit: 'base', baseBranch: 'main', project: 'p' }),
    put: async () => {}, delete: async () => {}
  }};
  let writes = 0;
  const create = runFunction(sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchDiff('), 'codeWorkbenchBranchCreate', {
    codeRepoOk: () => true, codePushGuard: guard, codeVerifyRef: x => x,
    codeWorkbenchBranchKey: () => 'key', codeCreateTempBranch: async () => { writes++; return { ok: true, branch: 'code/new', base: 'main', sha: 'base' }; },
    codeGitRefUrl: () => 'https://api.github.com/ref',
    codeGhApi: async () => { writes++; return { ok: true }; }
  });
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchRejectFile', {
    codeRepoOk: () => true, codePathOk: () => true, codePushGuard: guard,
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/owned', baseCommit: 'base' }),
    codeWorkbenchBranchKey: () => 'key', codeGetFile: async () => { writes++; return { ok: true, exists: true, text: 'x', sha: 'blob' }; },
    codeUpdateFile: async () => { writes++; return { ok: true }; }
  });
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: guard, codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async () => { writes++; return { ok: true, data: {} }; },
    codeMergeTempBranch: async () => { writes++; return { ok: true, data: { sha: 'merged' } }; }
  });
  const save = runFunction(sourceOf('async function codeWorkbenchBranchSaveFileUnlocked(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchSaveFileUnlocked', {
    codeRepoOk: () => true, codePathOk: () => true, codePushGuard: guard,
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/owned' }),
    codeGetFile: async () => { writes++; return { ok: true, exists: true, sha: 'blob' }; },
    codeUpdateFile: async () => { writes++; return { ok: true }; }
  });
  const rollback = runFunction(sourceOf('async function codeRollbackUnlocked(', 'async function codeRollback('), 'codeRollbackUnlocked', {
    codeHistoryLoad: async () => [{ id: 'history', repo, baseBranch: 'main', previous_sha: 'old-sha', files: ['a.js'] }],
    codeRepoOk: () => true, codeVerifyRef: x => x, codePushGuard: guard,
    codeGhApi: async () => { writes++; return { ok: true, data: {} }; }
  });
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscardUnlocked(', 'async function codeWorkbenchBranchDiscard('), 'codeWorkbenchBranchDiscardUnlocked', {
    codeRepoOk: () => true, codePushGuard: guard,
    codeWorkbenchBranchKey: () => 'key', codeDeleteBranch: async () => { writes++; return { ok: true }; }
  });
  const preview = runFunction(sourceOf('async function codeWorkbenchBranchPreviewUnlocked(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchPreviewUnlocked', {
    codePushGuard: guard,
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, branch: 'code/owned' }),
    codeGhApi: async () => { writes++; return { ok: true }; }
  });
  assert.equal((await create(env, 'intruder', { repo, project: 'p' })).ok, false);
  assert.equal((await reject(env, 'automation-bot', { repo, path: 'a.js' })).ok, false);
  assert.equal((await merge(env, 'intruder', { repo, branch: 'code/owned' })).ok, false);
  assert.equal((await save(env, 'intruder', { repo, branch: 'code/owned', path: 'a.js', content: 'x', sha: 'a'.repeat(40) })).ok, false);
  assert.equal((await rollback(env, 'intruder', { id: 'history' })).ok, false);
  assert.equal((await discard(env, 'intruder', { repo, branch: 'code/owned' })).ok, false);
  assert.equal((await preview(env, 'intruder', repo)).ok, false);
  assert.equal(writes, 0, 'unauthorized calls must not reach GitHub writes');

  const createdKV = { value: null, async put(_k, v) { this.value = JSON.parse(v); }, async get() { return null; } };
  const authorizedCreate = runFunction(sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchDiff('), 'codeWorkbenchBranchCreate', {
    codeRepoOk: () => true, codePushGuard: () => '', codeVerifyRef: x => x,
    codeWorkbenchBranchKey: () => 'key', codeCreateTempBranch: async () => ({ ok: true, branch: 'code/authorized', base: 'main', sha: 'base' }),
    codeTempPreview: () => '', codeGitRefUrl: () => '', codeGhApi: async () => ({ ok: true }),
  });
  const authorizedEnv = { ...env, KV: createdKV };
  const made = await authorizedCreate(authorizedEnv, 'owner', { repo, project: 'p' });
  assert.equal(made.ok, true);
  assert.equal(createdKV.value.created_by, 'owner', 'branch creation audit records the authenticated actor');

  const history = [];
  const authorizedMerge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: [{ filename: 'a.js' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base' } } };
      if (url.includes('/heads/code/')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected ' + url);
    },
    codeMergeTempBranch: async () => ({ ok: true, data: { sha: 'merged-sha' } }),
    codeHistoryLoad: async () => history, codeHistorySave: async (_e, _u, rows) => history.splice(0, history.length, ...rows),
    codeDeleteBranch: async () => ({ ok: true }), codeGitRefUrl: (r, ref) => 'https://api.github.com/repos/' + r + '/git/ref/' + ref,
    codeVerifyRef: x => x, codePathOk: () => true
  });
  const mergeEnv = { KV: { get: async () => ({ project: 'p', repo, branch: 'code/p', baseBranch: 'main', baseCommit: 'base' }), delete: async () => {} } };
  const merged = await authorizedMerge(mergeEnv, 'owner', { repo, branch: 'code/p' });
  assert.equal(merged.ok, true);
  assert.equal(history[0].actor, 'owner', 'merge history records the authenticated actor');
});

test('ACCEPTANCE IDEMPOTENCY-01: repeated create reuses one branch and repeated merge cannot create a second commit', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  let record = null, branchCreates = 0, mergeCalls = 0, history = [];
  const kv = {
    async get() { return record; },
    async put(_k, value) { record = JSON.parse(value); },
    async delete() { record = null; }
  };
  const create = runFunction(sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchDiff('), 'codeWorkbenchBranchCreate', {
    codeRepoOk: () => true, codePushGuard: () => '', codeVerifyRef: x => x,
    codeWorkbenchBranchKey: () => 'key', codeTempBranch: () => 'code/p-idempotent',
    codeCreateTempBranch: async () => { branchCreates++; return { ok: true, branch: 'code/p-idempotent', base: 'main', sha: 'base' }; },
    codeGitRefUrl: () => 'https://api.github.com/ref',
    codeGhApi: async () => ({ ok: true, data: { object: { sha: 'base' } } }),
    codeTempPreview: () => ''
  });
  const env = { KV: kv };
  const first = await create(env, 'owner', { repo, project: 'p' });
  const second = await create(env, 'owner', { repo, project: 'p' });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(second.existing, true);
  assert.equal(branchCreates, 1, 'duplicate create must reuse the active branch');

  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: [{ filename: 'a.js' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base' } } };
      if (url.endsWith('/heads/code/p-idempotent')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected ' + url);
    },
    codeMergeTempBranch: async () => { mergeCalls++; return { ok: true, data: { sha: 'once-only-sha' } }; },
    codeHistoryLoad: async () => history, codeHistorySave: async (_e, _u, rows) => history.splice(0, history.length, ...rows),
    codeDeleteBranch: async () => ({ ok: true }), codeGitRefUrl: (r, ref) => 'https://api.github.com/repos/' + r + '/git/ref/' + ref,
    codeVerifyRef: x => x, codePathOk: () => true
  });
  const mergeEnv = { KV: kv };
  const branchName = record.branch;
  const one = await merge(mergeEnv, 'owner', { repo, branch: branchName });
  const two = await merge(mergeEnv, 'owner', { repo, branch: branchName });
  assert.equal(one.ok, true);
  assert.equal(two.ok, false, 'a completed merge replay must not be accepted as a second merge');
  assert.equal(mergeCalls, 1);
  assert.equal(history.length, 1);
});

test('ACCEPTANCE MULTI-REVIEW-01: mixed file review keeps accepted files and rejects rename/delete side effects', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  const files = {
    'keep.js': { base: 'base-keep', branch: 'edited-keep' },
    'add.js': { base: null, branch: 'new-add' },
    'old-name.js': { base: 'original-name', branch: null },
    'new-name.js': { base: null, branch: 'renamed-content' },
    'deleted.js': { base: 'must-stay', branch: null }
  };
  const record = { repo, branch: 'code/mixed', baseBranch: 'main', baseCommit: 'base', project: 'mixed' };
  const kv = { async get() { return record; }, async put(_k, value) { Object.assign(record, JSON.parse(value)); }, async delete() {} };
  const deletedPaths = [], restored = [];
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchRejectFile', {
    codeRepoOk: () => true, codePathOk: () => true, codePushGuard: () => '',
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, ...record }),
    codeWorkbenchBranchKey: () => 'key',
    codeGhUrl: (r, p) => 'https://api.github.com/repos/' + r + '/contents/' + p,
    codeGetFile: async (_e, _r, p, ref) => {
      const row = files[p]; if (!row) return { ok: true, exists: false };
      const value = ref === 'base' ? row.base : row.branch;
      return value == null ? { ok: true, exists: false } : { ok: true, exists: true, text: value, sha: p + '-sha' };
    },
    codeUpdateFile: async (_e, _r, p, value) => { files[p].branch = value; restored.push(p); return { ok: true }; },
    codeGhApi: async (_e, url, options) => {
      const p = decodeURIComponent(url.split('/contents/')[1] || '');
      deletedPaths.push(p); files[p].branch = null; return { ok: true };
    }
  });
  const renameRejected = await reject({ KV: kv }, 'owner', { repo, path: 'new-name.js', previous_path: 'old-name.js', branch: record.branch });
  assert.equal(renameRejected.ok, true);
  assert.equal(files['old-name.js'].branch, 'original-name', 'renamed source path is restored');
  assert.equal(files['new-name.js'].branch, null, 'renamed destination path is removed');
  assert.deepEqual(restored, ['old-name.js']);
  assert.ok(deletedPaths.some(p => p.endsWith('new-name.js')));
  assert.equal(record.last_reviewed_by, 'owner');
  assert.equal(record.review_events[0].actor, 'owner', 'file review audit records the authenticated reviewer');

  // The merge coordinator must pass previous_filename to the reject operation.
  const changes = [
    { filename: 'keep.js', status: 'modified' },
    { filename: 'add.js', status: 'added' },
    { filename: 'new-name.js', previous_filename: 'old-name.js', status: 'renamed' },
    { filename: 'deleted.js', status: 'removed' }
  ];
  let compareCount = 0, mergeFiles = [], rejected = [];
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: compareCount++ === 0 ? changes : [{ filename: 'keep.js' }, { filename: 'add.js' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base' } } };
      if (url.endsWith('/heads/code/mixed')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected ' + url);
    },
    codeWorkbenchBranchRejectFileUnlocked: async (_e, _u, body) => { rejected.push(body); return { ok: true }; },
    codeMergeTempBranch: async (_e, _r, _b, _base, _msg) => { mergeFiles = ['keep.js', 'add.js']; return { ok: true, data: { sha: 'merged' } }; },
    codeHistoryLoad: async () => [], codeHistorySave: async () => {}, codeDeleteBranch: async () => ({ ok: true }),
    codeGitRefUrl: (r, ref) => 'https://api.github.com/repos/' + r + '/git/ref/' + ref,
    codeVerifyRef: x => x, codePathOk: () => true
  });
  const merged = await merge({ KV: kv }, 'owner', { repo, branch: record.branch, accepted_paths: ['keep.js', 'add.js'] });
  assert.equal(merged.ok, true);
  assert.deepEqual(rejected.map(x => x.path).sort(), ['deleted.js', 'new-name.js']);
  const renameCall = rejected.find(x => x.path === 'new-name.js');
  assert.equal(renameCall.previous_path, 'old-name.js', 'rename source is included in rejection');
  assert.deepEqual(mergeFiles, ['keep.js', 'add.js']);
});

test('ACCEPTANCE CLEANUP-01: failed deletion retains recoverable state; successful cancel clears branch and state for the next task', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  let record = { repo, branch: 'code/cleanup', project: 'cleanup', status: 'active' };
  let deleteFails = true, deletes = 0;
  const history = [];
  const kv = {
    async get() { return record; },
    async delete() { record = null; },
    async put(_k, value) { record = JSON.parse(value); }
  };
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscardUnlocked(', 'async function codeWorkbenchBranchMergeUnlocked('), 'codeWorkbenchBranchDiscard', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeDeleteBranch: async () => { deletes++; return deleteFails ? { ok: false, status: 500, msg: 'simulated failure' } : { ok: true }; },
    codeHistoryLoad: async () => history,
    codeHistorySave: async (_env, _user, rows) => { history.splice(0, history.length, ...rows); }
  });
  const env = { KV: kv };
  const failed = await discard(env, 'owner', { repo, branch: record.branch });
  assert.equal(failed.ok, false);
  assert.ok(record && record.branch, 'failed GitHub deletion must retain the branch record for retry');
  deleteFails = false;
  const cancelled = await discard(env, 'owner', { repo, branch: record.branch });
  assert.equal(cancelled.ok, true);
  assert.equal(record, null, 'successful cancellation clears review state');
  assert.equal(deletes, 2);
  assert.equal(history[0].kind, 'workbench_discard');
  assert.equal(history[0].actor, 'owner');

  // A fresh task can create a new isolated branch after cancellation.
  const create = runFunction(sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchDiff('), 'codeWorkbenchBranchCreate', {
    codeRepoOk: () => true, codePushGuard: () => '', codeVerifyRef: x => x,
    codeWorkbenchBranchKey: () => 'key', codeCreateTempBranch: async () => ({ ok: true, branch: 'code/next-task', base: 'main', sha: 'base2' }),
    codeTempPreview: () => '', codeGitRefUrl: () => '', codeGhApi: async () => ({ ok: true })
  });
  const next = await create(env, 'owner', { repo, project: 'next-task' });
  assert.equal(next.ok, true);
  assert.equal(next.branch, 'code/next-task');
});


test('ACCEPTANCE DISCARD-AUDIT-RECOVERY-01: deleted branches retain a durable audit-retry record across current-state reads', async () => {
  const repo = 'owner/repo';
  let record = { repo, branch: 'code/discard-audit', project: 'p', status: 'active' };
  const history = [];
  let auditFails = true, deletes = 0;
  const kv = {
    async get() { return record; },
    async put(_key, value) { record = JSON.parse(value); },
    async delete() { record = null; }
  };
  const env = { KV: kv };
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscardUnlocked(', 'async function codeWorkbenchBranchDiscard('), 'codeWorkbenchBranchDiscardUnlocked', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeDeleteBranch: async () => { deletes++; return deletes === 1 ? { ok: true } : { ok: false, status: 404 }; },
    codeHistoryLoad: async () => history,
    codeHistorySave: async (_env, _user, _repo, rows) => {
      if (auditFails) { auditFails = false; throw new Error('simulated history outage'); }
      history.splice(0, history.length, ...rows);
    }
  });
  const current = runFunction(sourceOf('async function codeWorkbenchBranchCurrent(', 'async function codeWorkbenchBranchCreateUnlocked('), 'codeWorkbenchBranchCurrent', {
    codeRepoOk: () => true, codeWorkbenchBranchKey: () => 'key',
    codeGitRefUrl: () => 'https://api.github.com/git/ref/code/discard-audit',
    codeGhApi: async () => ({ ok: false, status: 404 })
  });

  const failed = await discard(env, 'owner', { repo, branch: record.branch });
  assert.equal(failed.ok, false);
  assert.equal(failed.discarded, true);
  assert.equal(failed.branch_deleted, true);
  assert.equal(record.status, 'discard_history_failed');

  const snapshot = await current(env, 'owner', repo);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.discard_recovery, true);
  assert.equal(snapshot.branch_deleted, true);
  assert.equal(record.status, 'discard_history_failed', 'a 404 current-state probe must not erase audit recovery state');

  const retried = await discard(env, 'owner', { repo, branch: record.branch });
  assert.equal(retried.ok, true);
  assert.equal(record, null);
  assert.equal(history[0].kind, 'workbench_discard');
  assert.equal(history[0].actor, 'owner');
  assert.equal(deletes, 2);
});

test('ACCEPTANCE LOCK-CLEANUP-01: failed or cancelled claim releases its operation lock and permits the next task', async () => {
  const claimSource = sourceOf('class CodeClaimDO {', 'export class CodeRunnerDO');
  const Claim = runFunction(claimSource, 'CodeClaimDO', {
    Response, Request, URL, CODE_PENDING_TTL_MS: 600000,
    codePendingView: p => p,
    codeDeleteBranch: async () => ({ ok: true })
  });
  const values = new Map();
  let transactionTail = Promise.resolve();
  const storage = {
    async get(k) { return values.get(k); },
    async put(k, v) { values.set(k, v); },
    async delete(k) { values.delete(k); },
    async setAlarm() {},
    transaction(fn) {
      const next = transactionTail.then(() => fn({
        get: async k => values.get(k),
        put: async (k, v) => { values.set(k, v); },
        delete: async k => { values.delete(k); }
      }));
      transactionTail = next.catch(() => {});
      return next;
    }
  };
  const instance = new Claim({ storage }, {});
  const call = async (action, body) => {
    const response = await instance.fetch(new Request('https://claim/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));
    return response.json();
  };
  // Durable Object branch-operation locks serialize duplicate create/merge requests.
  const lockId = 'workbench:tianxin1300/openmanus-gateway';
  const lockOne = await call('branch-lock', { lock_id: lockId, token: 'token-one' });
  assert.equal(lockOne.acquired, true);
  const lockTwo = await call('branch-lock', { lock_id: lockId, token: 'token-two' });
  assert.equal(lockTwo.ok, false);
  assert.equal(lockTwo.busy, true, 'second operation cannot enter while the first lock is active');
  const wrongRelease = await call('branch-unlock', { lock_id: lockId, token: 'token-two' });
  assert.equal(wrongRelease.ok, false, 'a different operation cannot release the active lock');
  const released = await call('branch-unlock', { lock_id: lockId, token: 'token-one' });
  assert.equal(released.released, true);
  const lockAgain = await call('branch-lock', { lock_id: lockId, token: 'token-three' });
  assert.equal(lockAgain.acquired, true, 'a released lock permits the next operation');
  assert.equal((await call('branch-unlock', { lock_id: lockId, token: 'token-three' })).released, true);
  await storage.put('workbench_locks', { [lockId]: { token: 'expired-token', expires_at: Date.now() - 1 } });
  const afterExpiry = await call('branch-lock', { lock_id: lockId, token: 'fresh-token' });
  assert.equal(afterExpiry.acquired, true, 'an abandoned lock can be reclaimed after its lease expires');
  const staleRelease = await call('branch-unlock', { lock_id: lockId, token: 'expired-token' });
  assert.equal(staleRelease.ok, false, 'an expired owner cannot release the replacement lock');
  assert.equal((await call('branch-unlock', { lock_id: lockId, token: 'fresh-token' })).released, true);

  const pending = { id: 'task-one', project: 'p', repo: 'tianxin1300/openmanus-gateway', branch: 'code/task-one',
    edits: [{ path: 'a.js', old: 'a', new: 'b' }], created_at: Date.now() };
  assert.equal((await call('create', { repo: pending.repo, pending })).ok, true);
  const claimArgs = { repo: pending.repo, pending_id: 'task-one', project: 'p', operation_id: 'op-one', version: 1, yes: true };
  assert.equal((await call('claim', claimArgs)).claimed, true);
  const duplicate = await call('claim', claimArgs);
  assert.equal(duplicate.in_progress, true, 'duplicate click while active is blocked by the operation lock');
  const finished = await call('finish', { repo: pending.repo, pending_id: 'task-one', operation_id: 'op-one', status: 'failed',
    result: { ok: false, reply: 'simulated push failure' }, edits: pending.edits });
  assert.equal(finished.ok, true);
  let stored = await storage.get('claim');
  assert.deepEqual(Object.keys(stored.claims), [], 'failed operation releases its lock');
  assert.equal(stored.pending.status, 'failed');

  const discarded = await call('discard', { repo: pending.repo, pending_id: 'task-one', version: stored.version });
  assert.equal(discarded.discarding, true);
  const cleared = await call('clear', { repo: pending.repo, pending_id: 'task-one', version: stored.version });
  assert.equal(cleared.cleared, true);
  assert.equal(await storage.get('claim'), undefined, 'cancel clears the review state and lock record');

  const next = { ...pending, id: 'task-two', branch: 'code/task-two' };
  const createdAgain = await call('create', { repo: next.repo, pending: next });
  assert.equal(createdAgain.ok, true, 'a new task can claim the cleared state');
});


test('ACCEPTANCE WORKBENCH-CONCURRENCY-01: simultaneous branch operations are serialized by the Durable Object lock', async () => {
  const helper = sourceOf('async function codeWorkbenchWithLock(', 'async function codeWorkbenchBranchCurrent(');
  const wrapper = sourceOf('async function codeWorkbenchBranchCreate(', 'async function codeWorkbenchBranchDiff(');
  const mergeWrapper = sourceOf('async function codeWorkbenchBranchMerge(', 'async function codeMemoryAppend(');
  let held = false, entered = 0, releaseRun;
  const wait = new Promise(resolve => { releaseRun = resolve; });
  const codeClaimCall = async (_env, _user, action, body) => {
    if (action === 'branch-lock') {
      if (held) return { ok: false, busy: true, msg: 'locked' };
      held = true; return { ok: true, acquired: true };
    }
    if (action === 'branch-unlock') { held = false; return { ok: true, released: true }; }
    throw new Error('unexpected lock action');
  };
  const create = runFunction(helper + '\n' + wrapper, 'codeWorkbenchBranchCreate', {
    codeWorkbenchLockCall: async (_env, _repo, action, body) => codeClaimCall(_env, 'owner', action, body),
    codeWorkbenchBranchCreateUnlocked: async () => { entered++; await wait; return { ok: true, branch: 'code/once' }; }
  });
  const merge = runFunction(helper + '\n' + mergeWrapper, 'codeWorkbenchBranchMerge', {
    codeWorkbenchLockCall: async (_env, _repo, action, body) => codeClaimCall(_env, 'owner', action, body),
    codeWorkbenchBranchMergeUnlocked: async () => { entered++; return { ok: true }; }
  });
  const env = { CODE_CLAIMS: {} };
  const first = create(env, 'owner', { repo: 'tianxin1300/openmanus-gateway' });
  await Promise.resolve();
  const second = await merge(env, 'different-authorized-user', { repo: 'tianxin1300/openmanus-gateway' });
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  assert.equal(entered, 1, 'a concurrent merge cannot enter while create owns the shared project lock');
  releaseRun();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(held, false, 'lock is released after the operation finishes');
});

test('ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01: create, save, preview and merge refuse to run without CODE_CLAIMS', async () => {
  const helper = sourceOf('async function codeWorkbenchWithLock(', 'async function codeWorkbenchBranchCurrent(');
  const createWrapper = sourceOf('async function codeWorkbenchBranchCreate(', 'async function codeWorkbenchBranchDiff(');
  const mergeWrapper = sourceOf('async function codeWorkbenchBranchMerge(', 'async function codeMemoryAppend(');
  const create = runFunction(helper + '\n' + createWrapper, 'codeWorkbenchBranchCreate', {
    codeWorkbenchBranchCreateUnlocked: async () => { throw new Error('must not execute'); }
  });
  const merge = runFunction(helper + '\n' + mergeWrapper, 'codeWorkbenchBranchMerge', {
    codeWorkbenchBranchMergeUnlocked: async () => { throw new Error('must not execute'); }
  });
  const saveWrapper = sourceOf('async function codeWorkbenchBranchSaveFileUnlocked(', 'async function codeWorkbenchBranchPreview(');
  const save = runFunction(helper + '\n' + saveWrapper, 'codeWorkbenchBranchSaveFile', {
    codeWorkbenchBranchSaveFileUnlocked: async () => { throw new Error('must not execute'); }
  });
  const previewWrapper = sourceOf('async function codeWorkbenchBranchPreviewUnlocked(', 'async function codeWorkbenchBranchDiscardUnlocked(');
  const preview = runFunction(helper + '\n' + previewWrapper, 'codeWorkbenchBranchPreview', {
    codeWorkbenchBranchPreviewUnlocked: async () => { throw new Error('must not execute'); }
  });
  const noBinding = {};
  assert.equal((await create(noBinding, 'owner', { repo: 'tianxin1300/openmanus-gateway' })).ok, false);
  assert.equal((await merge(noBinding, 'owner', { repo: 'tianxin1300/openmanus-gateway' })).ok, false);
  assert.equal((await save(noBinding, 'owner', { repo: 'tianxin1300/openmanus-gateway' })).ok, false);
  assert.equal((await preview(noBinding, 'owner', 'tianxin1300/openmanus-gateway')).ok, false);
});


test('ACCEPTANCE WORKBENCH-LOCK-SCOPE-01: save, review, discard and preview also acquire the repository write lock', async () => {
  const calls = [];
  const lock = async (_env, _user, repo, operation, run) => {
    calls.push({ repo, operation });
    return run();
  };
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFile(', 'async function codeWorkbenchBranchSaveFileUnlocked('), 'codeWorkbenchBranchRejectFile', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchRejectFileUnlocked: async () => ({ ok: true, reviewed: true })
  });
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscard(', 'async function codeWorkbenchBranchMergeUnlocked('), 'codeWorkbenchBranchDiscard', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchDiscardUnlocked: async () => ({ ok: true, discarded: true })
  });
  const save = runFunction(sourceOf('async function codeWorkbenchBranchSaveFile(', 'async function codeWorkbenchBranchPreviewUnlocked('), 'codeWorkbenchBranchSaveFile', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchSaveFileUnlocked: async () => ({ ok: true, saved: true })
  });
  const preview = runFunction(sourceOf('async function codeWorkbenchBranchPreview(', 'async function codeWorkbenchBranchDiscardUnlocked('), 'codeWorkbenchBranchPreview', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchPreviewUnlocked: async () => ({ ok: true, preview: true })
  });
  assert.equal((await reject({}, 'reviewer', { repo: 'owner/repo', path: 'a.js' })).reviewed, true);
  assert.equal((await discard({}, 'owner', { repo: 'owner/repo' })).discarded, true);
  assert.equal((await save({}, 'owner', { repo: 'owner/repo' })).saved, true);
  assert.equal((await preview({}, 'owner', 'owner/repo')).preview, true);
  assert.deepEqual(calls, [
    { repo: 'owner/repo', operation: 'review' },
    { repo: 'owner/repo', operation: 'discard' },
    { repo: 'owner/repo', operation: 'save' },
    { repo: 'owner/repo', operation: 'preview' }
  ]);
  assert.match(worker, /codeWorkbenchBranchRejectFileUnlocked\(env, user, \{ repo, path, previous_path:/);
});


test('ACCEPTANCE MULTI-REVIEW-RECOVERY-01: failed rename rejection preserves a retryable destination', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  const files = {
    'old.js': { base: 'original', branch: null },
    'new.js': { base: null, branch: 'renamed' }
  };
  const record = { repo, branch: 'code/rename-recovery', baseBranch: 'main', baseCommit: 'base', project: 'p' };
  let auditWrites = 0, deleteAttempts = 0;
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchRejectFile('), 'codeWorkbenchBranchRejectFileUnlocked', {
    codeRepoOk: () => true, codePathOk: p => !!p && !p.includes('..'), codePushGuard: () => '',
    codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, ...record }),
    codeWorkbenchBranchKey: () => 'key',
    codeGetFile: async (_e, _r, p, ref) => {
      const row = files[p]; const value = ref === 'base' ? row.base : row.branch;
      return value == null ? { ok: true, exists: false } : { ok: true, exists: true, text: value, sha: p + '-sha' };
    },
    codeUpdateFile: async (_e, _r, p, value) => { files[p].branch = value; return { ok: true }; },
    codeGhUrl: (_r, p) => 'https://api.github.com/contents/' + p,
    codeGhApi: async (_e, url) => {
      deleteAttempts++;
      if (deleteAttempts === 1) return { ok: false, status: 500, msg: 'temporary delete failure' };
      files['new.js'].branch = null; return { ok: true };
    }
  });
  const kv = {
    async get() { return { ...record }; },
    async put() { auditWrites++; }
  };
  const env = { KV: kv };
  const first = await reject(env, 'reviewer', { repo, path: 'new.js', previous_path: 'old.js', branch: record.branch });
  assert.equal(first.ok, false);
  assert.equal(files['old.js'].branch, 'original', 'rename source is restored before destination deletion');
  assert.equal(files['new.js'].branch, 'renamed', 'failed deletion leaves destination intact for retry');
  assert.equal(auditWrites, 0, 'failed partial rejection is not recorded as a completed review');
  const second = await reject(env, 'reviewer', { repo, path: 'new.js', previous_path: 'old.js', branch: record.branch });
  assert.equal(second.ok, true);
  assert.equal(files['old.js'].branch, 'original');
  assert.equal(files['new.js'].branch, null);
  assert.equal(auditWrites, 1, 'successful retry records the review event');
});


test('ACCEPTANCE RENAME-REJECT-RESTORE-FAIL-01: failed source restoration never deletes the renamed destination or records a completed review', async () => {
  const repo = 'tianxin1300/openmanus-gateway';
  const record = { repo, branch: 'code/rename-restore-fail', baseBranch: 'main', baseCommit: 'base', project: 'rename-restore-fail' };
  const files = {
    'old-name.js': { base: 'original-source', branch: null },
    'new-name.js': { base: null, branch: 'renamed-content' }
  };
  let restoreFails = true;
  let destinationDeleteCalls = 0;
  let auditWrites = 0;
  const reject = runFunction(
    sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchPreview('),
    'codeWorkbenchBranchRejectFileUnlocked',
    {
      codeRepoOk: () => true,
      codePathOk: () => true,
      codePushGuard: () => '',
      codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, ...record }),
      codeWorkbenchBranchKey: () => 'rename-record',
      codeGhUrl: (_repo, path) => 'https://api.github.com/repos/' + repo + '/contents/' + path,
      codeGetFile: async (_env, _repo, path, ref) => {
        const entry = files[path];
        const value = ref === record.baseCommit ? entry.base : entry.branch;
        return value == null
          ? { ok: true, exists: false }
          : { ok: true, exists: true, text: value, sha: path + '-sha' };
      },
      codeUpdateFile: async (_env, _repo, path, value) => {
        if (restoreFails) return { ok: false, msg: 'simulated source restore failure' };
        files[path].branch = value;
        return { ok: true };
      },
      codeGhApi: async () => {
        destinationDeleteCalls++;
        files['new-name.js'].branch = null;
        return { ok: true };
      }
    }
  );
  const kv = {
    async get() { return { ...record }; },
    async put() { auditWrites++; }
  };
  const env = { KV: kv };
  const body = { repo, path: 'new-name.js', previous_path: 'old-name.js', branch: record.branch };

  const first = await reject(env, 'reviewer', body);
  assert.equal(first.ok, false);
  assert.equal(first.msg, '恢复基线文件失败：simulated source restore failure');
  assert.equal(files['old-name.js'].branch, null, 'failed source restore leaves source untouched');
  assert.equal(files['new-name.js'].branch, 'renamed-content', 'destination remains intact when source restoration fails');
  assert.equal(destinationDeleteCalls, 0, 'destination deletion must not run after source restoration failure');
  assert.equal(auditWrites, 0, 'failed rename rejection must not be audited as complete');

  restoreFails = false;
  const second = await reject(env, 'reviewer', body);
  assert.equal(second.ok, true);
  assert.equal(files['old-name.js'].branch, 'original-source');
  assert.equal(files['new-name.js'].branch, null);
  assert.equal(destinationDeleteCalls, 1);
  assert.equal(auditWrites, 1, 'only the successful retry records the review');
});

test('ACCEPTANCE CREATE-CLEANUP-01: KV persistence failure cleans the new branch or reports an orphan', async () => {
  const makeCreate = (cleanupOk, cleanupThrows = false) => runFunction(sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchCreate('), 'codeWorkbenchBranchCreateUnlocked', {
    codeVerifyRef: x => x, codeRepoOk: () => true, codePushGuard: () => '',
    codeWorkbenchBranchKey: () => 'branch-key', codeTempPreview: () => '',
    codeCreateTempBranch: async () => ({ ok: true, branch: 'code/persist-failure', base: 'main', sha: 'base-sha' }),
    codeDeleteBranch: async (_env, _repo, branch) => {
      assert.equal(branch, 'code/persist-failure');
      if (cleanupThrows) throw new Error('network dropped');
      return cleanupOk ? { ok: true } : { ok: false, status: 500, msg: 'GitHub unavailable' };
    }
  });
  const env = { KV: { get: async () => null, put: async () => { throw new Error('KV unavailable'); } } };
  const cleaned = await makeCreate(true)(env, 'owner', { repo: 'owner/repo', project: 'p' });
  assert.equal(cleaned.ok, false);
  assert.equal(cleaned.orphaned, false);
  assert.match(cleaned.msg, /已清理/);
  const orphaned = await makeCreate(false)(env, 'owner', { repo: 'owner/repo', project: 'p' });
  assert.equal(orphaned.ok, false);
  assert.equal(orphaned.orphaned, true);
  assert.equal(orphaned.branch, 'code/persist-failure');
  assert.match(orphaned.msg, /清理失败/);
  const thrown = await makeCreate(false, true)(env, 'owner', { repo: 'owner/repo', project: 'p' });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.orphaned, true);
  assert.match(thrown.msg, /network dropped/);
});


test('ACCEPTANCE REVIEW-GUARD-01: invalid paths are rejected before file reads or writes', async () => {
  const h = makeRejectHarness();
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: '../secret.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('ACCEPTANCE REVIEW-GUARD-02: protected file paths are rejected before GitHub access', async () => {
  const h = makeRejectHarness({ codePushGuard: () => 'protected path' });
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: 'worker.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.writes, 0);
});

test('ACCEPTANCE REVIEW-READ-01: baseline read failure does not mutate the branch', async () => {
  const h = makeRejectHarness({ codeGetFile: async () => ({ ok: false, msg: 'baseline unavailable' }) });
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: 'a.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.audits, 0);
});

test('ACCEPTANCE REVIEW-READ-02: branch read failure does not mutate the branch', async () => {
  const h = makeRejectHarness({ codeGetFile: async (_e, _r, _p, ref) => ref === 'base-sha'
    ? { ok: true, exists: true, text: 'base', sha: 'base-blob' }
    : { ok: false, msg: 'branch unavailable' } });
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: 'a.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.audits, 0);
});

test('ACCEPTANCE REVIEW-WRITE-01: failed baseline restoration is not recorded as a completed review', async () => {
  const h = makeRejectHarness({ codeUpdateFile: async () => ({ ok: false, msg: 'GitHub write failed' }) });
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: 'a.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.audits, 0);
});

test('ACCEPTANCE REVIEW-WRITE-02: failed deletion of a rejected added file is not audited as success', async () => {
  const h = makeRejectHarness({
    codeGetFile: async (_e, _r, _p, ref) => ref === 'base-sha'
      ? { ok: true, exists: false }
      : { ok: true, exists: true, text: 'new', sha: 'new-blob' },
    codeGhApi: async () => ({ ok: false, status: 500, msg: 'delete failed' })
  });
  const result = await h.reject(h.env, 'reviewer', { repo: 'owner/repo', path: 'new.js' });
  assert.equal(result.ok, false);
  assert.equal(h.stats.audits, 0);
});


test('ACCEPTANCE MERGE-HISTORY-RECOVERY-01: history failure is retried without merging twice', async () => {
  let saveCalls = 0, deleteCalls = 0;
  const savedHistory = [];
  const h = makeMergeHarness({
    globals: {
      codeHistorySave: async (_env, _user, _repo, rows) => { saveCalls++; if (saveCalls === 1) throw new Error('history KV unavailable'); savedHistory.splice(0, savedHistory.length, ...rows); },
      codeDeleteBranch: async () => { deleteCalls++; return { ok: true }; }
    }
  });
  const first = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(first.ok, false);
  assert.equal(first.merged, true);
  assert.equal(h.state.record.status, 'merged_history_failed');
  assert.equal(deleteCalls, 0, 'branch is retained until history is safely saved');
  assert.equal(h.state.mergeCalls, 1);
  const second = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(second.ok, true);
  assert.equal(second.cleanup_retry, true);
  assert.equal(h.state.mergeCalls, 1, 'retry must not call GitHub merge again');
  assert.equal(savedHistory.length, 1, 'retry writes the missing history row');
  assert.equal(deleteCalls, 1);
});

test('ACCEPTANCE MERGE-CLEANUP-01: branch deletion failure is retried without a second merge', async () => {
  let deleteCalls = 0;
  const h = makeMergeHarness({
    globals: {
      codeDeleteBranch: async () => { deleteCalls++; return deleteCalls === 1
        ? { ok: false, status: 500, msg: 'GitHub unavailable' }
        : { ok: true }; }
    }
  });
  const first = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(first.ok, false);
  assert.equal(first.merged, true);
  assert.equal(h.state.record.status, 'merged_cleanup_failed');
  const second = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(second.ok, true);
  assert.equal(second.cleanup_retry, true);
  assert.equal(h.state.mergeCalls, 1);
  assert.equal(deleteCalls, 2);
});

test('ACCEPTANCE MERGE-RECORD-CLEANUP-01: KV record deletion failure does not repeat the merge', async () => {
  let deleteCalls = 0, kvDeleteCalls = 0;
  const h = makeMergeHarness({
    globals: { codeDeleteBranch: async () => { deleteCalls++; return { ok: true }; } },
    kvDelete: async () => {
      kvDeleteCalls++;
      if (kvDeleteCalls === 1) throw new Error('KV delete unavailable');
      h.state.record = null;
    }
  });
  const first = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(first.ok, false);
  assert.equal(first.merged, true);
  assert.equal(first.record_cleanup_failed, true);
  assert.equal(h.state.record.status, 'merged_record_cleanup_failed');
  const second = await h.merge(h.env, 'owner', { repo: 'owner/repo', branch: 'code/p' });
  assert.equal(second.ok, true);
  assert.equal(second.cleanup_retry, true);
  assert.equal(h.state.mergeCalls, 1);
  assert.equal(deleteCalls, 2, 'retry treats an already deleted branch as a safe cleanup target');
  assert.equal(kvDeleteCalls, 2);
});


test('ACCEPTANCE IDEMPOTENCY-CONCURRENT-CREATE-01: simultaneous duplicate creates produce one branch and retry reuses it', async () => {
  let held = false, createCalls = 0, record = null, finishCreate;
  const wait = new Promise(resolve => { finishCreate = resolve; });
  const helper = sourceOf('async function codeWorkbenchLockCall(', 'async function codeWorkbenchBranchCurrent(');
  const createBlock = sourceOf('async function codeWorkbenchBranchCreateUnlocked(', 'async function codeWorkbenchBranchDiff(');
  const lockStub = { fetch: async (url, init) => {
    const action = new URL(url).pathname.slice(1);
    if (action === 'branch-lock') {
      if (held) return new Response(JSON.stringify({ ok: false, busy: true, msg: 'locked' }), { status: 409 });
      held = true; return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    held = false; return new Response(JSON.stringify({ ok: true, released: true }), { status: 200 });
  } };
  const create = runFunction(helper + '\n' + createBlock, 'codeWorkbenchBranchCreate', {
    codeVerifyRef: x => x, codeRepoOk: () => true, codePushGuard: () => '',
    codeWorkbenchBranchKey: () => 'branch-key', codeTempPreview: () => '',
    codeCreateTempBranch: async () => { createCalls++; await wait; return { ok: true, branch: 'code/p-once', base: 'main', sha: 'base-sha' }; },
    codeGitRefUrl: (_repo, ref) => 'https://api.github.com/heads/' + ref,
    codeGhApi: async () => ({ ok: true, data: { object: { sha: 'base-sha' } } })
  });
  const env = { CODE_CLAIMS: { idFromName: name => name, get: () => lockStub }, KV: {
    get: async () => record,
    put: async (_key, value) => { record = JSON.parse(value); },
    delete: async () => { record = null; }
  } };
  const first = create(env, 'owner', { repo: 'owner/repo', project: 'p' });
  await Promise.resolve();
  const concurrent = await create(env, 'owner', { repo: 'owner/repo', project: 'p' });
  assert.equal(concurrent.ok, false);
  assert.equal(concurrent.busy, true);
  assert.equal(createCalls, 1, 'only one concurrent request reaches GitHub branch creation');
  finishCreate();
  const made = await first;
  assert.equal(made.ok, true);
  const retry = await create(env, 'owner', { repo: 'owner/repo', project: 'p' });
  assert.equal(retry.ok, true);
  assert.equal(retry.existing, true, 'retry after lock release reuses the already-created branch');
  assert.equal(createCalls, 1, 'no second branch is created');
});


test('ACCEPTANCE WORKBENCH-LOCK-CASE-01: case variants of one repository resolve to the same lock identity', async () => {
  let resolvedId = '';
  const stub = { fetch: async () => new Response(JSON.stringify({ ok: true, acquired: true }), { status: 200 }) };
  const lockCall = runFunction(sourceOf('async function codeWorkbenchLockCall(', 'async function codeWorkbenchWithLock('), 'codeWorkbenchLockCall', {});
  const result = await lockCall({
    CODE_CLAIMS: {
      idFromName(name) { resolvedId = name; return name; },
      get() { return stub; }
    }
  }, 'OWNER/Repo', 'branch-lock', { lock_id: 'workbench:owner/repo', token: 't' });
  assert.equal(result.ok, true);
  assert.equal(resolvedId, 'workbench:owner/repo');
});


test('ACCEPTANCE WORKBENCH-LOCK-ATOMIC-01: simultaneous lock acquisition is atomic in the Durable Object transaction', async () => {
  const Claim = runFunction(sourceOf('class CodeClaimDO {', 'export class CodeRunnerDO'), 'CodeClaimDO', {
    Response, Request, URL, CODE_PENDING_TTL_MS: 600000, codePendingView: p => p,
    codeDeleteBranch: async () => ({ ok: true })
  });
  const values = new Map();
  let tail = Promise.resolve();
  const storage = {
    async get(k) { return values.get(k); },
    async put(k, v) { values.set(k, v); },
    async delete(k) { values.delete(k); },
    async setAlarm() {},
    transaction(fn) {
      const next = tail.then(() => fn({
        get: async k => values.get(k),
        put: async (k, v) => { values.set(k, v); },
        delete: async k => { values.delete(k); }
      }));
      tail = next.catch(() => {});
      return next;
    }
  };
  const instance = new Claim({ storage }, {});
  const call = async (token) => {
    const response = await instance.fetch(new Request('https://claim/branch-lock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_id: 'workbench:owner/repo', token })
    }));
    return response.json();
  };
  const results = await Promise.all([call('one'), call('two')]);
  assert.equal(results.filter(x => x.acquired).length, 1, 'exactly one concurrent request owns the lock');
  assert.equal(results.filter(x => x.busy).length, 1, 'the other concurrent request is rejected');
});

test('ACCEPTANCE WORKBENCH-LOCK-RENEW-01: only the current unexpired owner can renew a lease', async () => {
  const Claim = runFunction(sourceOf('class CodeClaimDO {', 'export class CodeRunnerDO'), 'CodeClaimDO', {
    Response, Request, URL, CODE_PENDING_TTL_MS: 600000, codePendingView: p => p,
    codeDeleteBranch: async () => ({ ok: true })
  });
  const values = new Map();
  const storage = {
    async get(k) { return values.get(k); },
    async put(k, v) { values.set(k, v); },
    async delete(k) { values.delete(k); },
    async setAlarm() {},
    async transaction(fn) { return fn({
      get: async k => values.get(k),
      put: async (k, v) => { values.set(k, v); },
      delete: async k => { values.delete(k); }
    }); }
  };
  const instance = new Claim({ storage }, {});
  const call = async (action, token) => {
    const response = await instance.fetch(new Request('https://claim/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_id: 'workbench:owner/repo', token })
    }));
    return response.json();
  };
  const acquired = await call('branch-lock', 'owner');
  await new Promise(resolve => setTimeout(resolve, 5));
  const renewed = await call('branch-renew', 'owner');
  assert.equal(renewed.renewed, true);
  assert.ok(renewed.expires_at > acquired.expires_at);
  const stale = await call('branch-renew', 'intruder');
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal((await call('branch-unlock', 'owner')).released, true);
});


test('ACCEPTANCE MERGE-CAS-01: merge updates the target ref only from the exact reviewed base SHA', async () => {
  const calls = [];
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40), previewSha = 'c'.repeat(40), treeSha = 'd'.repeat(40), finalSha = 'e'.repeat(40);
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x,
    codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-test',
    codeDeleteBranch: async (_env, _repo, branch) => { calls.push(['DELETE', branch]); return { ok: true }; },
    codeGhApi: async (_env, url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      calls.push([options.method || 'GET', url, body]);
      if (url.endsWith('/heads/main') && (!options.method || options.method === 'GET')) return { ok: true, data: { object: { sha: baseSha } } };
      if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: headSha } } };
      if (url.endsWith('/git/refs') && options.method === 'POST') return { ok: true, data: {} };
      if (url.endsWith('/merges')) return { ok: true, data: { sha: previewSha, commit: { tree: { sha: treeSha } } } };
      if (url.endsWith('/git/commits') && options.method === 'POST') return { ok: true, data: { sha: finalSha } };
      if (url.endsWith('/heads/main') && options.method === 'PATCH') return { ok: true, data: {} };
      if (url.includes('/git/refs/heads/main') && options.method === 'PATCH') return { ok: true, data: {} };
      throw new Error('unexpected API call: ' + options.method + ' ' + url);
    }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test merge', baseSha, headSha);
  assert.equal(result.ok, true);
  assert.equal(result.cas, true);
  assert.equal(result.data.sha, finalSha);
  const commitCall = calls.find(x => x[0] === 'POST' && x[1].endsWith('/git/commits'));
  assert.equal(commitCall[2].tree, treeSha);
  assert.deepEqual(commitCall[2].parents, [baseSha, headSha]);
  const deleteIndex = calls.findIndex(x => x[0] === 'DELETE');
  const updateIndex = calls.findIndex(x => x[0] === 'PATCH' && x[1].includes('/git/refs/heads/main'));
  assert.ok(deleteIndex >= 0 && updateIndex > deleteIndex, 'scratch ref is cleaned before target ref update');
  assert.equal(calls[updateIndex][2].force, false, 'target ref update must be fast-forward only');
});

test('ACCEPTANCE MERGE-CAS-02: base advancement after merge calculation is rejected by non-fast-forward CAS', async () => {
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40), treeSha = 'd'.repeat(40);
  let patched = false;
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-race',
    codeDeleteBranch: async () => ({ ok: true }),
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main') && (!options.method || options.method === 'GET')) return { ok: true, data: { object: { sha: baseSha } } };
      if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: headSha } } };
      if (url.endsWith('/git/refs')) return { ok: true, data: {} };
      if (url.endsWith('/merges')) return { ok: true, data: { sha: 'c'.repeat(40), commit: { tree: { sha: treeSha } } } };
      if (url.endsWith('/git/commits')) return { ok: true, data: { sha: 'e'.repeat(40) } };
      if (url.includes('/git/refs/heads/main') && options.method === 'PATCH') {
        patched = true;
        return { ok: false, status: 422, msg: 'Update is not a fast forward' };
      }
      throw new Error('unexpected API call ' + options.method + ' ' + url);
    }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test race', baseSha, headSha);
  assert.equal(patched, true);
  assert.equal(result.ok, false);
  assert.equal(result.cas_rejected, true);
  assert.equal(result.conflict, true);
});

test('ACCEPTANCE MERGE-CAS-03: base or reviewed head drift is rejected before creating a scratch ref', async () => {
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
  for (const drift of ['base', 'head']) {
    let scratchCreated = false;
    const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
      codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
      codeTempBranch: () => 'code/merge-txn-drift',
      codeDeleteBranch: async () => ({ ok: true }),
      codeGhApi: async (_env, url, options = {}) => {
        if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: drift === 'base' ? 'f'.repeat(40) : baseSha } } };
        if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: drift === 'head' ? 'f'.repeat(40) : headSha } } };
        if (url.endsWith('/git/refs')) { scratchCreated = true; return { ok: true, data: {} }; }
        throw new Error('merge should stop before scratch creation');
      }
    });
    const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test drift', baseSha, headSha);
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.equal(scratchCreated, false);
  }
});

test('ACCEPTANCE MERGE-CAS-04: failed scratch cleanup prevents target ref mutation', async () => {
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
  let targetPatch = false;
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-orphan',
    codeDeleteBranch: async () => ({ ok: false, status: 500, msg: 'delete denied' }),
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: baseSha } } };
      if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: headSha } } };
      if (url.endsWith('/git/refs')) return { ok: true, data: {} };
      if (url.endsWith('/merges')) return { ok: true, data: { sha: 'c'.repeat(40), commit: { tree: { sha: 'd'.repeat(40) } } } };
      if (url.includes('/git/refs/heads/main') && options.method === 'PATCH') targetPatch = true;
      throw new Error('target branch must not be updated');
    }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test cleanup', baseSha, headSha);
  assert.equal(result.ok, false);
  assert.equal(result.scratch_cleanup_failed, true);
  assert.equal(result.scratch_branch, 'code/merge-txn-orphan');
  assert.equal(targetPatch, false);
});


test('ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-01: long-running workbench operation renews and then releases its lock', async () => {
  const calls = [];
  let tick = null, cleared = false;
  const helper = sourceOf('async function codeWorkbenchWithLock(', 'async function codeWorkbenchBranchCurrent(');
  const wrapped = runFunction(helper, 'codeWorkbenchWithLock', {
    codeWorkbenchLockCall: async (_env, _repo, action) => { calls.push(action); return { ok: true }; },
    setInterval: fn => { tick = fn; return 77; },
    clearInterval: id => { assert.equal(id, 77); cleared = true; }
  });
  const result = await wrapped({ CODE_CLAIMS: {} }, 'owner', 'owner/repo', 'merge', async () => {
    assert.equal(typeof tick, 'function');
    tick();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { ok: true };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['branch-lock', 'branch-renew', 'branch-unlock']);
  assert.equal(cleared, true);
});

test('ACCEPTANCE WORKBENCH-LOCK-HEARTBEAT-FAIL-01: failed lease renewal aborts subsequent GitHub requests and reports uncertainty', async () => {
  const helper = sourceOf('async function codeWorkbenchWithLock(', 'async function codeWorkbenchBranchCurrent(');
  const localLocks = new Map();
  let apiCalls = 0, aborted = false;
  const api = runFunction(sourceOf('async function codeGhApi(', 'function codeGitRefUrl('), 'codeGhApi', {
    codeWorkbenchLocalLockControllers: localLocks,
    codeGhHeaders: () => ({}),
    T: ms => AbortSignal.timeout(ms),
    fetch: async () => { apiCalls++; return { ok: true, status: 200, text: async () => "{}" }; }
  });
  const wrapped = runFunction(helper, 'codeWorkbenchWithLock', {
    codeWorkbenchLocalLockControllers: localLocks,
    codeWorkbenchLockCall: async (_env, _repo, action) => action === 'branch-renew'
      ? { ok: false, stale: true, msg: 'lease expired' } : { ok: true },
    setInterval: fn => { globalThis.__renewTick = fn; return 88; },
    clearInterval: () => { delete globalThis.__renewTick; }
  });
  const result = await wrapped({ CODE_CLAIMS: {} }, 'owner', 'owner/repo', 'merge', async () => {
    const controller = localLocks.get('workbench:owner/repo');
    globalThis.__renewTick();
    await new Promise(resolve => setTimeout(resolve, 0));
    aborted = controller.signal.aborted;
    const blocked = await api({ GH_PAT: 'test-token' }, 'https://api.github.com/repos/owner/repo/contents/a.js');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 409);
    return { ok: true, merged: true };
  });
  assert.equal(result.ok, false);
  assert.equal(result.lock_renewal_failed, true);
  assert.equal(result.operation_aborted, true);
  assert.equal(result.operation_result.merged, true);
  assert.equal(aborted, true);
  assert.equal(apiCalls, 0, 'no subsequent GitHub request may be issued after the lease is lost');
  assert.equal(localLocks.size, 0, 'the local abort controller is removed after release');
  assert.match(result.msg, /核对 GitHub 实际结果/);
});


test('ACCEPTANCE MERGE-CAS-05: thrown scratch cleanup errors block target ref mutation and preserve orphan ref name', async () => {
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
  let targetPatch = false;
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-throw',
    codeDeleteBranch: async () => { throw new Error('simulated delete transport failure'); },
    codeGhApi: async (_env, url, options = {}) => {
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: baseSha } } };
      if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: headSha } } };
      if (url.endsWith('/git/refs')) return { ok: true, data: {} };
      if (url.endsWith('/merges')) return { ok: true, data: { sha: 'c'.repeat(40), commit: { tree: { sha: 'd'.repeat(40) } } } };
      if (url.endsWith('/git/commits')) return { ok: true, data: { sha: 'e'.repeat(40) } };
      if (url.includes('/git/refs/heads/main') && options.method === 'PATCH') targetPatch = true;
      throw new Error('unexpected API call');
    }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test cleanup throw', baseSha, headSha);
  assert.equal(result.ok, false);
  assert.equal(result.scratch_cleanup_failed, true);
  assert.equal(result.scratch_branch, 'code/merge-txn-throw');
  assert.match(result.msg, /simulated delete transport failure/);
  assert.equal(targetPatch, false);
});

test('ACCEPTANCE MERGE-CAS-06: invalid reviewed SHA values are rejected before any GitHub write', async () => {
  let writes = 0;
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-invalid',
    codeDeleteBranch: async () => ({ ok: true }),
    codeGhApi: async (_env, _url, options = {}) => { if (options.method && options.method !== 'GET') writes++; return { ok: true, data: { object: { sha: 'a'.repeat(40) } } }; }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test invalid sha', 'not-a-sha', 'also-not-a-sha');
  assert.equal(result.ok, false);
  assert.match(result.msg, /SHA 不合法/);
  assert.equal(writes, 0);
});

test('ACCEPTANCE MERGE-CAS-07: scratch branch creation failure stops before merge commit creation or target update', async () => {
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
  const calls = [];
  const merge = runFunction(sourceOf('async function codeMergeTempBranch(', 'const codeHistoryKey ='), 'codeMergeTempBranch', {
    codeVerifyRef: x => x, codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeTempBranch: () => 'code/merge-txn-create-fail',
    codeDeleteBranch: async () => ({ ok: true }),
    codeGhApi: async (_env, url, options = {}) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: baseSha } } };
      if (url.endsWith('/heads/code/review')) return { ok: true, data: { object: { sha: headSha } } };
      if (url.endsWith('/git/refs')) return { ok: false, status: 403, msg: 'permission denied' };
      throw new Error('later merge steps must not execute');
    }
  });
  const result = await merge({}, 'owner/repo', 'code/review', 'main', 'test scratch create fail', baseSha, headSha);
  assert.equal(result.ok, false);
  assert.match(result.msg, /创建隔离合并基线失败/);
  assert.equal(calls.some(x => x[0].endsWith('/merges')), false);
  assert.equal(calls.some(x => x[0].endsWith('/git/commits')), false);
  assert.equal(calls.some(x => x[0].includes('/git/refs/heads/main') && x[1] === 'PATCH'), false);
});

test('ACCEPTANCE GIT-REF-WRITE-01: branch deletion uses GitHub write-ref endpoint', async () => {
  const calls = [];
  const remove = runFunction(sourceOf('async function codeDeleteBranch(', 'async function codeMergeTempBranch('), 'codeDeleteBranch', {
    codeGitRefWriteUrl: (_repo, ref) => 'https://api.github.com/repos/owner/repo/git/refs/' + ref,
    codeGhApi: async (_env, url, options = {}) => { calls.push([url, options.method]); return { ok: true, status: 204 }; }
  });
  const result = await remove({}, 'owner/repo', 'code/project-test');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['https://api.github.com/repos/owner/repo/git/refs/heads/code/project-test', 'DELETE']]);
  const invalid = await remove({}, 'owner/repo', 'main');
  assert.equal(invalid.ok, false);
  assert.equal(calls.length, 1, 'invalid branch names must not reach GitHub');
});

test('ACCEPTANCE WORKBENCH-CAS-CONFLICT-01: GitHub 422 non-fast-forward is surfaced as a workbench conflict', async () => {
  const repo = 'owner/repo';
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMergeUnlocked', {
    codeRepoOk: () => true,
    codePushGuard: () => '',
    codeWorkbenchBranchKey: () => 'key',
    codeGitRefUrl: (_repo, ref) => 'https://api.github.com/git/ref/' + ref,
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: [{ filename: 'app.js' }] } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'a'.repeat(40) } } };
      if (url.includes('/heads/code/')) return { ok: true, data: { object: { sha: 'b'.repeat(40) } } };
      throw new Error('unexpected API ' + url);
    },
    codeMergeTempBranch: async () => ({ ok: false, status: 422, conflict: true, cas_rejected: true, msg: 'Update is not a fast forward' }),
    codeHistoryLoad: async () => [],
    codeHistorySave: async () => {},
    codeDeleteBranch: async () => { throw new Error('failed merge must keep the temp branch'); },
    codeVerifyRef: x => x,
    codePathOk: () => true
  });
  const result = await merge({ KV: { get: async () => ({ repo, branch: 'code/p', baseBranch: 'main', baseCommit: 'a'.repeat(40), project: 'p' }) } }, 'actor', { repo, branch: 'code/p' });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.match(result.msg, /Update is not a fast forward/);
});


test('ACCEPTANCE RENAME-REJECT-MERGE-01: real rename rejection restores the source and excludes both paths from merge', async () => {
  const repo = 'owner/repo';
  const baseSha = 'a'.repeat(40);
  const branchSha = 'b'.repeat(40);
  const record = { repo, branch: 'code/rename-regression', baseBranch: 'main', baseCommit: baseSha, project: 'rename-regression', status: 'active' };
  const files = {
    'keep.js': { base: 'base-keep', branch: 'edited-keep' },
    'old-name.js': { base: 'original-source', branch: null },
    'new-name.js': { base: null, branch: 'renamed-content' }
  };
  const history = [];
  let compareCalls = 0;
  let mergeCalls = 0;
  const kv = {
    async get() { return record; },
    async put(_key, value) { Object.assign(record, JSON.parse(value)); },
    async delete() { this.deleted = true; }
  };
  const reject = runFunction(
    sourceOf('async function codeWorkbenchBranchRejectFileUnlocked(', 'async function codeWorkbenchBranchRejectFile('),
    'codeWorkbenchBranchRejectFileUnlocked',
    {
      codeRepoOk: () => true,
      codePathOk: path => typeof path === 'string' && !!path && !path.startsWith('/') && !path.split('/').includes('..'),
      codePushGuard: () => '',
      codeWorkbenchBranchCurrent: async () => ({ ok: true, active: true, ...record }),
      codeWorkbenchBranchKey: () => 'branch-key',
      codeGetFile: async (_env, _repo, path, ref) => {
        const row = files[path];
        if (!row) return { ok: true, exists: false };
        const value = ref === baseSha ? row.base : row.branch;
        return value == null ? { ok: true, exists: false } : { ok: true, exists: true, text: value, sha: path + '-sha' };
      },
      codeUpdateFile: async (_env, _repo, path, content) => {
        files[path].branch = content;
        return { ok: true };
      },
      codeGhUrl: (_repo, path) => 'https://api.github.com/repos/owner/repo/contents/' + path,
      codeGhApi: async (_env, url, options = {}) => {
        if (options.method === 'DELETE') {
          const path = decodeURIComponent(url.split('/contents/')[1]);
          files[path].branch = null;
          return { ok: true };
        }
        throw new Error('unexpected reject API call: ' + url);
      }
    }
  );
  const merge = runFunction(
    sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeWorkbenchBranchMerge('),
    'codeWorkbenchBranchMergeUnlocked',
    {
      codeRepoOk: () => true,
      codePushGuard: () => '',
      codeWorkbenchBranchKey: () => 'branch-key',
      codeWorkbenchBranchRejectFileUnlocked: reject,
      codeGhApi: async (_env, url) => {
        if (url.includes('/compare/')) {
          compareCalls++;
          if (compareCalls === 1) {
            return { ok: true, data: { files: [
              { filename: 'keep.js', status: 'modified' },
              { filename: 'new-name.js', previous_filename: 'old-name.js', status: 'renamed' }
            ] } };
          }
          const remaining = [];
          for (const [path, row] of Object.entries(files)) {
            if (row.base === row.branch) continue;
            if (row.base == null && row.branch != null) remaining.push({ filename: path, status: 'added' });
            else if (row.base != null && row.branch == null) remaining.push({ filename: path, status: 'removed' });
            else if (row.base !== row.branch) remaining.push({ filename: path, status: 'modified' });
          }
          return { ok: true, data: { files: remaining } };
        }
        if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: baseSha } } };
        if (url.endsWith('/heads/code/rename-regression')) return { ok: true, data: { object: { sha: branchSha } } };
        throw new Error('unexpected merge API call: ' + url);
      },
      codeGitRefUrl: (_repo, ref) => 'https://api.github.com/repos/owner/repo/git/ref/' + ref,
      codeMergeTempBranch: async () => { mergeCalls++; return { ok: true, data: { sha: 'merged-rename-regression' } }; },
      codeHistoryLoad: async () => history,
      codeHistorySave: async (_env, _user, _repo, rows) => { history.splice(0, history.length, ...rows); },
      codeDeleteBranch: async () => ({ ok: true })
    }
  );

  const result = await merge({ KV: kv }, 'reviewer', {
    repo, branch: record.branch, accepted_paths: ['keep.js']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.files, ['keep.js'], 'the post-rejection compare must contain only the accepted path');
  assert.equal(files['old-name.js'].branch, 'original-source', 'the old source path is restored to its baseline content');
  assert.equal(files['new-name.js'].branch, null, 'the renamed destination path is removed from the temp branch');
  assert.equal(mergeCalls, 1, 'only the remaining accepted diff is merged');
  assert.equal(compareCalls, 2, 'merge must re-read GitHub diff after applying the real rejection helper');
  assert.deepEqual(history[0].files, ['keep.js']);
  assert.equal(kv.deleted, true);
});


test('ACCEPTANCE WORKBENCH-AUTH-ROUTE-01: workbench HTTP routes reject missing, invalid and expired tokens before dispatch', async () => {
  const authSource = sourceOf('function sameStr(', 'const getKeys =');
  const userSource = sourceOf('async function userFromReq(', 'const getKeys =');
  const routeSource = sourceOf('    if (path === "/api/code/branch/current"', '    if (path === "/api/code/tree"');
  const route = runFunction(
    authSource + '\n' + userSource +
    '\nasync function testWorkbenchRoute(request, env, url, path) {\n' + routeSource + '\nreturn null;\n}',
    'testWorkbenchRoute',
    {
      AG_RE: /$^/,
      json: (value, status = 200) => new Response(JSON.stringify(value), { status }),
      codeWorkbenchBranchCurrent: async () => ({ ok: true }),
      codeWorkbenchBranchCreate: async () => ({ ok: true }),
      codeWorkbenchBranchDiff: async () => ({ ok: true }),
      codeWorkbenchBranchRejectFile: async () => ({ ok: true }),
      codeWorkbenchBranchSaveFile: async () => ({ ok: true }),
      codeWorkbenchBranchPreview: async () => ({ ok: true }),
      codeWorkbenchBranchMerge: async () => ({ ok: true }),
      codeWorkbenchBranchDiscard: async () => ({ ok: true })
    }
  );
  const routes = [
    ['GET', '/api/code/branch/current', 'current'],
    ['POST', '/api/code/branch/create', 'create'],
    ['GET', '/api/code/branch/diff', 'diff'],
    ['POST', '/api/code/branch/reject-file', 'reject'],
    ['POST', '/api/code/branch/save-file', 'save'],
    ['POST', '/api/code/branch/preview', 'preview'],
    ['POST', '/api/code/branch/merge', 'merge'],
    ['POST', '/api/code/branch/discard', 'discard']
  ];
  const kvValues = new Map([['token:valid-token', 'authenticated-user']]);
  const env = { KV: { get: async key => kvValues.has(key) ? kvValues.get(key) : null } };
  for (const [method, pathname] of routes) {
    for (const authorization of ['', 'Bearer invalid-token', 'Bearer expired-token']) {
      const request = {
        method,
        headers: new Headers(authorization ? { Authorization: authorization } : {}),
        json: async () => ({ repo: 'owner/repo', token: '' })
      };
      const response = await route(request, env, new URL('https://worker.test' + pathname + '?repo=owner/repo'), pathname);
      assert.ok(response instanceof Response, pathname + ' returns an HTTP response');
      assert.equal(response.status, 401, pathname + ' rejects ' + (authorization || 'missing token'));
      assert.match((await response.json()).msg, /未登录|token失效/);
    }
    const request = {
      method,
      headers: new Headers({ Authorization: 'Bearer valid-token' }),
      json: async () => ({ repo: 'owner/repo', token: '' })
    };
    const response = await route(request, env, new URL('https://worker.test' + pathname + '?repo=owner/repo'), pathname);
    assert.equal(response.status, 200, pathname + ' dispatches for a valid bearer token');
  }
});


function makeProjectSwitchHarness({ dirty: initialDirty, confirmResult }) {
  const calls = [];
  const projectSelect = { value: 'tianxin1300/openmanus-gateway' };
  const fileLabel = { textContent: 'old/path.js' };
  const decisions = { 'old/path.js': true, 'other.js': false };
  const oldRecord = { repo: 'tianxin1300/openmanus-gateway', branch: 'code/old-project' };
  const sandbox = {
    WORKBENCH_PROJECTS: {
      'tianxin1300/openmanus-gateway': { owner: 'tianxin1300', repo: 'openmanus-gateway' },
      'owner-b/second-project': { owner: 'owner-b', repo: 'second-project' }
    },
    REPO: { owner: 'tianxin1300', repo: 'openmanus-gateway', branch: 'code/old-project' },
    dirty: initialDirty,
    confirm: () => confirmResult,
    g: id => id === 'wb-project' ? projectSelect : (id === 'wb-file' ? fileLabel : null),
    activeBranchRecord: oldRecord,
    workbenchDecisions: decisions,
    FILE: 'old/path.js',
    curSha: 'old-file-sha',
    updateWorkbenchBranchUI: () => calls.push(['update-ui', sandbox.REPO.repo]),
    workbenchRepoFull() { return this.REPO.owner + '/' + this.REPO.repo; },
    ensureWorkbenchBranch: async () => {
      calls.push(['ensure-branch', sandbox.REPO.owner + '/' + sandbox.REPO.repo]);
      sandbox.activeBranchRecord = { repo: sandbox.workbenchRepoFull(), branch: 'code/new-project' };
      sandbox.REPO.branch = 'code/new-project';
      return sandbox.activeBranchRecord;
    },
    loadFile: async () => calls.push(['load-file', sandbox.workbenchRepoFull(), sandbox.FILE]),
    loadWorkbenchTree: async () => calls.push(['load-tree', sandbox.workbenchRepoFull()]),
    loadWorkbenchChanges: async () => calls.push(['load-changes', sandbox.workbenchRepoFull()]),
    loadWorkbenchVersions: async () => calls.push(['load-versions', sandbox.workbenchRepoFull()]),
    say: message => calls.push(['say', message])
  };
  const source = sourceOfFrontend(frontend, 'async function switchWorkbenchProject(', '\ng("wb-file-search")');
  vm.runInNewContext(source + '\nglobalThis.__switchProject = switchWorkbenchProject;', sandbox);
  return { sandbox, calls, projectSelect, fileLabel, decisions, oldRecord };
}

test('ACCEPTANCE WORKBENCH-PROJECT-01: cancelling a dirty project switch preserves the current branch and edits', async () => {
  const h = makeProjectSwitchHarness({ dirty: true, confirmResult: false });
  await h.sandbox.__switchProject('owner-b/second-project');
  assert.deepEqual({ ...h.sandbox.REPO }, { owner: 'tianxin1300', repo: 'openmanus-gateway', branch: 'code/old-project' });
  assert.equal(h.sandbox.activeBranchRecord, h.oldRecord);
  assert.deepEqual({ ...h.decisions }, { 'old/path.js': true, 'other.js': false });
  assert.equal(h.sandbox.FILE, 'old/path.js');
  assert.equal(h.sandbox.curSha, 'old-file-sha');
  assert.equal(h.sandbox.dirty, true);
  assert.equal(h.projectSelect.value, 'tianxin1300/openmanus-gateway');
  assert.equal(h.calls.some(call => call[0] === 'ensure-branch'), false);
});

test('ACCEPTANCE WORKBENCH-PROJECT-02: switching projects clears old branch state and loads the new project branch', async () => {
  const h = makeProjectSwitchHarness({ dirty: true, confirmResult: true });
  await h.sandbox.__switchProject('owner-b/second-project');
  assert.deepEqual({ ...h.sandbox.REPO }, { owner: 'owner-b', repo: 'second-project', branch: 'code/new-project' });
  assert.deepEqual({ ...h.sandbox.activeBranchRecord }, { repo: 'owner-b/second-project', branch: 'code/new-project' });
  assert.deepEqual({ ...h.decisions }, {});
  assert.equal(h.sandbox.FILE, 'frontend/index.html');
  assert.equal(h.sandbox.curSha, null);
  assert.equal(h.sandbox.dirty, false);
  assert.equal(h.fileLabel.textContent, 'frontend/index.html');
  assert.deepEqual(h.calls.filter(call => call[0] === 'ensure-branch'), [['ensure-branch', 'owner-b/second-project']]);
  assert.deepEqual(h.calls.filter(call => ['load-file', 'load-tree', 'load-changes', 'load-versions'].includes(call[0])).map(call => call.slice(0, 2)), [
    ['load-file', 'owner-b/second-project'],
    ['load-tree', 'owner-b/second-project'],
    ['load-changes', 'owner-b/second-project'],
    ['load-versions', 'owner-b/second-project']
  ]);
});
