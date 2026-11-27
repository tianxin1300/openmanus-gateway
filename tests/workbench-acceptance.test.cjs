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
  const sandbox = { ...globals, URL, Date, Math, JSON, Set, Map, Promise, console, crypto: require('node:crypto').webcrypto, codeWorkbenchWithLock: async (_env, _user, _repo, _operation, run) => run() };
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
  const merge = runFunction(sourceOf('async function codeWorkbenchBranchMergeUnlocked(', 'async function codeMemoryAppend('), 'codeWorkbenchBranchMerge', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'branch-key',
    codeGhApi: async (_env, url) => {
      if (url.includes('/compare/')) return { ok: true, data: { files: Object.keys(branch).filter(k => branch[k] !== main[k]).map(filename => ({ filename })) } };
      if (url.endsWith('/heads/main')) return { ok: true, data: { object: { sha: 'base-sha' } } };
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
  const rollback = runFunction(sourceOf('async function codeRollback(', 'const CODE_DEPLOY_WORKFLOW'), 'codeRollback', {
    codeHistoryLoad: async () => rows,
    codeHistorySave: async (_env, _user, next) => { rows.splice(0, rows.length, ...next); },
    codeVerifyRef: x => x, codeRepoOk: () => true, codePushGuard: () => '',
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


test('ACCEPTANCE PERMISSION-01: unauthorized identities cannot create, review, or merge; authorized actions are attributed', async () => {
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
  assert.equal((await create(env, 'intruder', { repo, project: 'p' })).ok, false);
  assert.equal((await reject(env, 'automation-bot', { repo, path: 'a.js' })).ok, false);
  assert.equal((await merge(env, 'intruder', { repo, branch: 'code/owned' })).ok, false);
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
  const kv = {
    async get() { return record; },
    async delete() { record = null; },
    async put(_k, value) { record = JSON.parse(value); }
  };
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscardUnlocked(', 'async function codeWorkbenchBranchMergeUnlocked('), 'codeWorkbenchBranchDiscard', {
    codeRepoOk: () => true, codePushGuard: () => '', codeWorkbenchBranchKey: () => 'key',
    codeDeleteBranch: async () => { deletes++; return deleteFails ? { ok: false, status: 500, msg: 'simulated failure' } : { ok: true }; }
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


test('ACCEPTANCE LOCK-CLEANUP-01: failed or cancelled claim releases its operation lock and permits the next task', async () => {
  const claimSource = sourceOf('class CodeClaimDO {', 'export class CodeRunnerDO');
  const Claim = runFunction(claimSource, 'CodeClaimDO', {
    Response, Request, URL, CODE_PENDING_TTL_MS: 600000,
    codePendingView: p => p,
    codeDeleteBranch: async () => ({ ok: true })
  });
  const values = new Map();
  const storage = {
    async get(k) { return values.get(k); },
    async put(k, v) { values.set(k, v); },
    async delete(k) { values.delete(k); },
    async setAlarm() {}
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
  assert.equal((await call('create', { pending })).ok, true);
  const claimArgs = { pending_id: 'task-one', project: 'p', operation_id: 'op-one', version: 1, yes: true };
  assert.equal((await call('claim', claimArgs)).claimed, true);
  const duplicate = await call('claim', claimArgs);
  assert.equal(duplicate.in_progress, true, 'duplicate click while active is blocked by the operation lock');
  const finished = await call('finish', { pending_id: 'task-one', operation_id: 'op-one', status: 'failed',
    result: { ok: false, reply: 'simulated push failure' }, edits: pending.edits });
  assert.equal(finished.ok, true);
  let stored = await storage.get('claim');
  assert.deepEqual(Object.keys(stored.claims), [], 'failed operation releases its lock');
  assert.equal(stored.pending.status, 'failed');

  const discarded = await call('discard', { pending_id: 'task-one', version: stored.version });
  assert.equal(discarded.discarding, true);
  const cleared = await call('clear', { pending_id: 'task-one', version: stored.version });
  assert.equal(cleared.cleared, true);
  assert.equal(await storage.get('claim'), undefined, 'cancel clears the review state and lock record');

  const next = { ...pending, id: 'task-two', branch: 'code/task-two' };
  const createdAgain = await call('create', { pending: next });
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

test('ACCEPTANCE WORKBENCH-LOCK-FAIL-CLOSED-01: create and merge refuse to run without CODE_CLAIMS', async () => {
  const helper = sourceOf('async function codeWorkbenchWithLock(', 'async function codeWorkbenchBranchCurrent(');
  const createWrapper = sourceOf('async function codeWorkbenchBranchCreate(', 'async function codeWorkbenchBranchDiff(');
  const mergeWrapper = sourceOf('async function codeWorkbenchBranchMerge(', 'async function codeMemoryAppend(');
  const create = runFunction(helper + '\n' + createWrapper, 'codeWorkbenchBranchCreate', {
    codeWorkbenchBranchCreateUnlocked: async () => { throw new Error('must not execute'); }
  });
  const merge = runFunction(helper + '\n' + mergeWrapper, 'codeWorkbenchBranchMerge', {
    codeWorkbenchBranchMergeUnlocked: async () => { throw new Error('must not execute'); }
  });
  const noBinding = {};
  assert.equal((await create(noBinding, 'owner', { repo: 'tianxin1300/openmanus-gateway' })).ok, false);
  assert.equal((await merge(noBinding, 'owner', { repo: 'tianxin1300/openmanus-gateway' })).ok, false);
});


test('ACCEPTANCE WORKBENCH-LOCK-SCOPE-01: review and discard also acquire the repository write lock', async () => {
  const calls = [];
  const lock = async (_env, _user, repo, operation, run) => {
    calls.push({ repo, operation });
    return run();
  };
  const reject = runFunction(sourceOf('async function codeWorkbenchBranchRejectFile(', 'async function codeWorkbenchBranchPreview('), 'codeWorkbenchBranchRejectFile', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchRejectFileUnlocked: async () => ({ ok: true, reviewed: true })
  });
  const discard = runFunction(sourceOf('async function codeWorkbenchBranchDiscard(', 'async function codeWorkbenchBranchMergeUnlocked('), 'codeWorkbenchBranchDiscard', {
    codeWorkbenchWithLock: lock,
    codeWorkbenchBranchDiscardUnlocked: async () => ({ ok: true, discarded: true })
  });
  assert.equal((await reject({}, 'reviewer', { repo: 'owner/repo', path: 'a.js' })).reviewed, true);
  assert.equal((await discard({}, 'owner', { repo: 'owner/repo' })).discarded, true);
  assert.deepEqual(calls, [
    { repo: 'owner/repo', operation: 'review' },
    { repo: 'owner/repo', operation: 'discard' }
  ]);
  assert.match(worker, /codeWorkbenchBranchRejectFileUnlocked\(env, user, \{ repo, path, previous_path:/);
});
