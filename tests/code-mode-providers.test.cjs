'use strict';

// Run from any directory: node --test /path/to/tests/code-mode-providers.test.cjs
// Evaluate the real source in isolated VMs. All fetches, timers and DOM APIs are
// mocked; this file does not import/start the Worker or contact any API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, 'studio.js'), 'utf8');
const frontendStudioSource = fs.readFileSync(path.join(root, 'frontend/studio.js'), 'utf8');
const blockedProviders = ['肖恩AI', 'Toter', 'Toter2'];
const messages = [{ role: 'user', content: 'Write a small function.' }];
const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

function loadCodePendingDiscard({ pending, deleteBranch, claimCall, kvDelete }) {
  const start = workerSource.indexOf('async function codePendingDiscard(');
  const end = workerSource.indexOf('// v108：cron 扫 KV', start);
  assert.ok(start >= 0 && end > start, 'codePendingDiscard source must exist');
  const source = workerSource.slice(start, end);
  const sandbox = {
    codePendingLoad: async () => pending,
    codeClaimState: async () => ({ ok: true, pending, version: 1 }),
    codeDeleteBranch: deleteBranch,
    codeClaimCall: claimCall,
    CODE_PENDING_TTL_MS: 600000,
    env: null,
    console
  };
  vm.runInNewContext(source + String.fromCharCode(10) + 'globalThis.testDiscard = codePendingDiscard;', sandbox);
  return sandbox.testDiscard;
}

function loadFrontendForceClear(stubs) {
  const start = frontendStudioSource.indexOf('  function clearOnServer() {');
  const end = frontendStudioSource.indexOf('  /* ---------- 读取待推送的修改 ---------- */', start);
  assert.ok(start >= 0 && end > start, 'frontend force-clear handlers must exist');
  const source = frontendStudioSource.slice(start, end);
  const sandbox = { api: stubs.api, busy: stubs.busy, say: stubs.say, hide: stubs.hide, toast: stubs.toast };
  vm.runInNewContext(source + String.fromCharCode(10) + 'globalThis.testForceClear = forceClear;', sandbox);
  return sandbox.testForceClear;
}

function loadCodeClaimDO(deleteBranch) {
  const start = workerSource.indexOf('export class CodeClaimDO');
  const end = workerSource.indexOf('export class CodeRunnerDO', start);
  assert.ok(start >= 0 && end > start, 'CodeClaimDO source must exist');
  const classSource = workerSource.slice(start, end).replace(/^export /, '');
  const sandbox = {
    CODE_PENDING_TTL_MS: 600000,
    codeDeleteBranch: deleteBranch,
    codePendingView: p => p,
    Date: class FixedDate extends Date { static now() { return 1700000000000; } }, URL, Response, Request, console
  };
  vm.runInNewContext(classSource + '\n' + 'globalThis.TestCodeClaimDO = CodeClaimDO;', sandbox);
  return sandbox.TestCodeClaimDO;
}

function loadCodeRunnerDO() {
  const start = workerSource.indexOf('export class CodeRunnerDO');
  const end = workerSource.indexOf('export default WORKER_DEFAULT', start);
  assert.ok(start >= 0 && end > start, 'CodeRunnerDO source must exist');
  const classSource = workerSource.slice(start, end).replace(/^export /, '');
  const values = new Map();
  let transactionTail = Promise.resolve();
  const storage = {
    async get(key) { return values.has(key) ? values.get(key) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { return values.delete(key); },
    async transaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        const txn = {
          async get(key) { return values.has(key) ? values.get(key) : undefined; },
          async put(key, value) { values.set(key, structuredClone(value)); },
          async delete(key) { return values.delete(key); }
        };
        return await callback(txn);
      } finally { release(); }
    }
  };
  const sandbox = { URL, Response, Request, Date, structuredClone };
  vm.runInNewContext(classSource + '\n' + 'globalThis.TestCodeRunnerDO = CodeRunnerDO;', sandbox);
  return { Runner: sandbox.TestCodeRunnerDO, storage };
}


test('worker and frontend expose only the requested Groq, OpenRouter and NVIDIA model lists', () => {
  const expectedGroq = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
  const expectedOpenRouter = [
    'inclusionai/ling-3.2-flash:free', 'particle-ai/particle-1:free',
    'baidu/ernie-5.5-flash-preview:free', 'nvidia/nemotron-3-ultra:free',
    'google/gemma-4-26b-a4b:free', 'nvidia/nemotron-3.5-super-vl:free'
  ];
  const expectedNvidia = [
    'nemotron-3-super-550b-a55b', 'nemotron-3.5-super-vl-120b-a12b',
    'nemotron-3.5-flash-30b-a3b', 'minimax-m3.1-flash',
    'nemotron-3-nano-omni-30b-a3b', 'glm-5-3-flash', 'nemotron-3.5-bolt-e4b',
    'laguna-xs-2.1', 'stepfun-step-5-preview', 'mistral-large-4', 'kimi-k3.1-pro'
  ];
  const list = (source, key) => {
    const match = source.match(new RegExp(`${key}: \\[([\\s\\S]*?)\\]`));
    assert.ok(match, `${key} list exists`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  };
  assert.deepEqual(list(workerSource, 'groq'), expectedGroq);
  assert.deepEqual(list(workerSource, 'openrouter'), expectedOpenRouter);
  const nvidiaStart = workerSource.indexOf('name: "NVIDIA", url: "https://integrate.api.nvidia.com/v1/chat/completions", keys: "NVIDIA_KEYS", models: [');
  const nvidiaTail = workerSource.slice(nvidiaStart);
  const nvidiaBlock = nvidiaTail.match(/models: \[([\s\S]*?)\n\s*\], max:/);
  assert.ok(nvidiaBlock, 'NVIDIA list exists');
  assert.deepEqual([...nvidiaBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1]), expectedNvidia);
  assert.ok(frontendSource.includes('"Groq": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]'));
  assert.ok(frontendSource.includes('"OpenRouter": ["inclusionai/ling-3.2-flash:free", "particle-ai/particle-1:free", "baidu/ernie-5.5-flash-preview:free", "nvidia/nemotron-3-ultra:free", "google/gemma-4-26b-a4b:free", "nvidia/nemotron-3.5-super-vl:free"]'));
  assert.ok(frontendSource.includes('"英伟达": ["nemotron-3-super-550b-a55b", "nemotron-3.5-super-vl-120b-a12b", "nemotron-3.5-flash-30b-a3b", "minimax-m3.1-flash", "nemotron-3-nano-omni-30b-a3b", "glm-5-3-flash", "nemotron-3.5-bolt-e4b", "laguna-xs-2.1", "stepfun-step-5-preview", "mistral-large-4", "kimi-k3.1-pro"]'));
  for (const old of ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-26b-a4b-it:free', 'liquid/lfm-3-1.7b:free', 'nvidia/nemotron-3.5-parse']) {
    assert.doesNotMatch(workerSource.match(/const WORK_MODELS = \{[\s\S]*?\n\};/)[0], new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('chat experience: prompt restores natural dialogue and frontend hides routine notes', () => {
  const agency = workerSource.match(/<conversation_agency>([\s\S]*?)<\/conversation_agency>/);
  assert.ok(agency, 'natural dialogue prompt exists');
  assert.match(agency[1], /不要把每一轮都套成固定/);
  assert.match(agency[1], /只有缺少会改变结果的关键信息、涉及高影响副作用或安全边界时才提问/);
  assert.match(agency[1], /不展示内部推理、路由、模型切换、工具调用过程/);

  const noteFilter = frontendSource.match(/\(m\.notes \|\| \[\]\)\.filter\(n => ([\s\S]*?)\)\.forEach/);
  assert.ok(noteFilter, 'frontend filters notes before rendering');
  assert.match(noteFilter[1], /⚠\|❌\|⏹/);
  assert.match(noteFilter[1], /失败\|错误\|超时\|没取到\|没找到\|无法/);
  assert.match(frontendSource, /模型切换、联网成功、来源统计等内部状态不混进正文/);
});

test('editor delivery: pending work is resumable and deployment state is not overstated', () => {
  // Functional: worker accepts awaiting_approval / partial / applied lifecycle
  assert.match(workerSource, /status: "awaiting_approval"/);
  assert.match(workerSource, /status: "partial"|status = "partial"|"partial"/);
  assert.match(workerSource, /consumed: true, status: "applied"/);
  // Partial failures keep remaining work for retry (message may be paraphrased)
  assert.match(workerSource, /已保留未成功的文件修改|可以重试|remaining/);
  // Studio must surface uncertain state without claiming auto-redeploy
  const studioBodies = [studioSource, frontendStudioSource];
  assert.ok(studioBodies.some(s => /状态暂时无法确认|修改仍保留|请稍后重试/.test(s)),
    'studio surfaces uncertain confirm result so user can retry');
  assert.ok(studioBodies.some(s => /p\.project \|\| state\.project/.test(s)),
    'studio falls back to state.project when pending omits project');
  // Root studio (feature-complete) must not overstate Cloudflare auto-redeploy
  assert.doesNotMatch(studioSource, /Cloudflare 会自动重新部署/);
});

test('project isolation: code edits use a temporary branch before merging to the base branch', () => {
  assert.match(workerSource, /async function codeCreateTempBranch\(env, repo, project, base = "main"\)/);
  assert.match(workerSource, /ref: "refs\/heads\/" \+ branch/);
  assert.match(workerSource, /async function codeMergeTempBranch\(env, repo, branch, base, message\)/);
  assert.match(workerSource, /await codeMergeTempBranch\(env, pend\.repo, pend\.branch/);
  assert.match(workerSource, /await codeDeleteBranch\(env, pend\.repo, pend\.branch\)/);
  assert.match(workerSource, /branch_deleted: true/);
  assert.match(workerSource, /baseBranch: temp\.base/);
  assert.doesNotMatch(workerSource, /codeUpdateFile\(env, pend\.repo, path, applied\.out\[path\], [\s\S]{0,160}branch = String\(env\.CODE_PUSH_BRANCH/);
});

test('web workbench: exposes the local preview control', () => {
  const previewButtons = [...frontendSource.matchAll(/<button\b(?=[^>]*\bid="wb-local-preview")[^>]*>/g)];
  assert.equal(previewButtons.length, 1);
});
test('remote verification: reuses a dispatchable workflow and returns status fields', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify-project.yml'), 'utf8');
  assert.match(workflow, /name: verify-project/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /run: npm install/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workerSource, /CODE_VERIFY_WORKFLOW = "verify-project\.yml"/);
  assert.match(workerSource, /actions\/workflows\/" \+ CODE_VERIFY_WORKFLOW \+ "\/dispatches/);
  assert.match(workerSource, /error_lines/);
  assert.match(workerSource, /preview_url/);
  assert.match(workerSource, /path === "\/api\/code\/verify"/);
});

test('BUG-07: verification logs preserve file context and expose exact source-line navigation', () => {
  const workerBlock = extract(workerSource, 'function codeVerifyRedact(text)', 'async function codeVerifyStatus');
  const workerContext = vm.createContext({});
  vm.runInContext(workerBlock, workerContext);
  const log = [
    'Run npm test',
    'AssertionError: expected true',
    '    at TestContext.<anonymous> (/home/runner/work/repo/repo/tests/code-mode-providers.test.cjs:1148:10)',
    '    at async Test.run (node:internal/test_runner/test:632:9)',
    'Error: build failed'
  ].join('\n');
  const kept = vm.runInContext('codeVerifyErrorLines(' + JSON.stringify(log) + ')', workerContext);
  assert.ok(kept.some(line => line.includes('tests/code-mode-providers.test.cjs:1148:10')));
  assert.ok(kept.some(line => line.includes('AssertionError')));
  assert.ok(kept.some(line => line.includes('TestContext.<anonymous>')));
  assert.match(workerSource, /locationPattern/);
  assert.match(frontendSource, /function verifyErrorLocation\(raw\)/);
  assert.match(frontendSource, /revealLineInCenter\(line\)/);
  assert.match(frontendSource, /setSelectionRange\(start/);
  assert.match(frontendSource, /renderVerifyErrorLocations\(d\.error_lines, d\.head_sha\)/);
  const locationBlock = extract(frontendSource, 'function verifyErrorLocation(raw)', 'function renderVerifyResult(d)');
  const locationContext = vm.createContext({REPO: {repo: 'openmanus-gateway', owner: 'tianxin1300'}});
  vm.runInContext(locationBlock, locationContext);
  const parsed = vm.runInContext('verifyErrorLocation("    at run (tests/code-mode-providers.test.cjs:1148:10)")', locationContext);
  assert.deepEqual({path: parsed.path, line: parsed.line, column: parsed.column},
    {path: 'tests/code-mode-providers.test.cjs', line: 1148, column: 10});
  const absolute = vm.runInContext('verifyErrorLocation("    at run (/home/runner/work/openmanus-gateway/openmanus-gateway/frontend/index.html:88:3)")', locationContext);
  assert.deepEqual({path: absolute.path, line: absolute.line, column: absolute.column},
    {path: 'frontend/index.html', line: 88, column: 3});
  const python = vm.runInContext('verifyErrorLocation(\'  File "worker.py", line 27\')', locationContext);
  assert.deepEqual({path: python.path, line: python.line, column: python.column},
    {path: 'worker.py', line: 27, column: 1});
});

test('remote verification UI: green success, red failures, and no invented preview URL', () => {
  assert.match(frontendSource, /验证通过/);
  assert.match(frontendSource, /验证失败/);
  assert.match(frontendSource, /d\.error_lines/);
  assert.match(frontendSource, /verifyLink\("打开项目预览", d\.preview_url\)/);
  assert.match(frontendSource, /没有配置预览地址/);
  assert.doesNotMatch(frontendSource, /window\.open\("https:\/\/github\.com\/" \+ REPO\.owner \+ "\/" \+ REPO\.repo \+ "\/actions"/);
});

test('BUG-01: protected media and files never put the login token in URLs or media bodies', () => {
  assert.doesNotMatch(frontendSource, /\?token=/);
  assert.doesNotMatch(frontendSource, /JSON\.stringify\(\{token/);
  assert.match(frontendSource, /authFetch\(GATEWAY \+ "\/api\/generate\/image"/);
  assert.match(frontendSource, /authFetch\(GATEWAY \+ "\/api\/generate\/audio"/);
  assert.match(frontendSource, /URL\.createObjectURL\(await media\.blob\(\)\)/);
  assert.match(frontendSource, /authFetch\(GATEWAY \+ "\/api\/files\/"/);
  assert.match(frontendSource, /window\.open\(url, "_blank", "noopener"\)/);
});

test('BUG-02 and BUG-05: verification inputs are validated, runs are correlated, and polling cannot hang', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify-project.yml'), 'utf8');
  assert.match(workflow, /VERIFY_REF: \$\{\{ github\.event\.inputs\.ref/);
  assert.match(workflow, /python3 - <<'PY'/);
  assert.match(workflow, /re\.search\(r"\[\\r\\n'\\"`;\]\|\\\$\\\(|&&"/);
  assert.match(workflow, /timeout-minutes: 12/);
  assert.doesNotMatch(workflow, /echo "- Ref: \$\{\{ github\.event\.inputs\.ref/);
  assert.match(workerSource, /const codeVerifyRef = \(ref\) =>/);
  assert.match(workerSource, /request_id: requestId/);
  assert.match(workerSource, /x\.name === marker/);
  assert.match(workerSource, /function codeVerifyRedact\(text\)/);
  assert.match(workerSource, /github_pat/);
  assert.match(workerSource, /API_KEY\|TOKEN/);
  assert.match(frontendSource, /VERIFY_MAX_MS = 10 \* 60 \* 1000/);
  assert.match(frontendSource, /VERIFY_MAX_POLLS/);
  assert.match(frontendSource, /new AbortController\(\)/);
  assert.match(frontendSource, /finally \{ clearTimeout\(timeout\)/);
  assert.match(frontendSource, /验证超时：10 分钟内未完成/);
});

test('BUG-03/04/06: push confirmation uses Durable Object atomic claim and idempotent operation fields', () => {
  const wrangler = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /name = "CODE_CLAIMS"/);
  assert.match(wrangler, /class_name = "CodeClaimDO"/);
  assert.match(workerSource, /export class CodeClaimDO/);
  assert.match(workerSource, /codeClaimCall\(env, user, "claim"/);
  // Required claim fields exist (wording of error message may vary)
  assert.match(workerSource, /pending_id.*version.*project.*operation_id|operation_id.*pending_id/);
  assert.match(workerSource, /p\.status = "applying"/);
  assert.match(workerSource, /current\.results\[operationId\]/);
  assert.match(workerSource, /current\.claims\[operationId\]/);
  // Must not fall back to the old non-atomic KV lock pattern
  assert.doesNotMatch(workerSource, /const key = "code:pend:" \+ user, lockKey/);
  // Feature-complete studio sends the four idempotency fields on confirm
  assert.match(studioSource, /pending_id:\s*op\.pending_id/);
  assert.match(studioSource, /version:\s*op\.version/);
  assert.match(studioSource, /project:\s*op\.project/);
  assert.match(studioSource, /operation_id:\s*operationId\(\)/);
});

test('Trae batch 1: isolated branches, history/rollback/preview, and file-level decisions', () => {
  // Worker: temp branch naming, preview, history, rollback, tree APIs
  assert.match(workerSource, /return "code\/" \+ tag \+ "-"/);
  assert.match(workerSource, /function codeTempPreview\(branch\)/);
  assert.match(workerSource, /codeHistoryKey/);
  assert.match(workerSource, /async function codeRollback/);
  assert.match(workerSource, /path === "\/api\/code\/history"/);
  assert.match(workerSource, /path === "\/api\/code\/rollback"/);
  assert.match(workerSource, /path === "\/api\/code\/tree"/);
  assert.match(workerSource, /accepted_paths/);
  assert.match(workerSource, /conflict_resolutions/);
  assert.match(workerSource, /choice\.choice === "mine"/);
  // Feature-complete studio (root) exposes preview / history / file decisions
  assert.match(studioSource, /打开临时预览|preview_url/);
  assert.match(studioSource, /历史版本|code\/history/);
  assert.match(studioSource, /搜索文件|code\/tree/);
  assert.match(studioSource, /接受/);
  assert.match(studioSource, /拒绝/);
  assert.match(studioSource, /我的/);
  assert.match(studioSource, /他的/);
  assert.match(frontendSource, /失败重试/);
});

test('BUG-08: CodeRunnerDO serializes per-user parallel-run claims and owner-only release', async () => {
  const { Runner, storage } = loadCodeRunnerDO();
  const runner = new Runner({ storage });
  const call = async (action, body) => {
    const response = await runner.fetch(new Request('https://runner/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));
    return response.json();
  };
  const concurrent = await Promise.all([
    call('claim', { request_id: 'both-a', ref: 'main' }),
    call('claim', { request_id: 'both-b', ref: 'main' })
  ]);
  assert.equal(concurrent.filter(result => result.ok).length, 1);
  const first = concurrent.find(result => result.ok);
  const loser = concurrent.find(result => !result.ok);
  assert.ok(['both-a', 'both-b'].includes(first.active.request_id));
  assert.equal(loser.active.request_id, first.active.request_id);
  const secondId = first.active.request_id === 'both-a' ? 'both-b' : 'both-a';
  const wrongRelease = await call('release', { request_id: secondId });
  assert.equal(wrongRelease.ok, false);
  const touched = await call('touch', { request_id: first.active.request_id, stage: 'polling' });
  assert.equal(touched.ok, true);
  assert.equal(touched.active.stage, 'polling');
  const released = await call('release', { request_id: first.active.request_id });
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  const retry = await call('claim', { request_id: secondId, ref: 'main' });
  assert.equal(retry.ok, true);
});

test('BUG-08: parallel deploy preserves partial dispatch failures and holds lock until remaining run ends', () => {
  const start = workerSource.slice(workerSource.indexOf('async function codeBothStart('), workerSource.indexOf('async function codeBothStatus('));
  const status = workerSource.slice(workerSource.indexOf('async function codeBothStatus('), workerSource.indexOf('async function codeVerifyStart('));
  assert.match(start, /codeRunnerLockCall\(env, user, "claim"/);
  assert.ok(start.indexOf('"claim"') < start.indexOf('"/dispatches"'));
  assert.match(start, /dispatch_error/);
  assert.match(start, /已启动的另一项任务仍在运行/);
  assert.match(status, /if \(r\.dispatch_error\)/);
  assert.match(status, /const state = running \? "running" : failed \? "failure" : "success"/);
  assert.match(status, /state === "success" \|\| state === "failure"[\s\S]*"release"/);
  assert.match(status, /"touch"/);
});

test('workbench simultaneous start triggers GitHub Actions and renders the full delivery chain', () => {
  assert.match(frontendSource, /id="wb-both"/);
  assert.match(frontendSource, /async function runBoth\(\)/);
  assert.match(frontendSource, /正在触发 GitHub Actions：前端 build \+ Worker deploy 并行跑/);
  assert.match(frontendSource, /authFetch\(GATEWAY \+ "\/api\/code\/both", \{ method: "POST"/);
  assert.match(frontendSource, /GitHub 返回 Pages 部署日志/);
  assert.match(frontendSource, /GitHub 返回 Worker deploy 日志/);
  assert.match(frontendSource, /j\.state === "success"/);
  assert.match(frontendSource, /j\.state === "failure"/);
  assert.match(frontendSource, /function renderDeliveryChain\(d\)/);
  assert.match(frontendSource, /authFetch\(GATEWAY \+ "\/api\/code\/pages-health"/);
  assert.match(frontendSource, /result\.status === 200/);
  assert.match(frontendSource, /new AbortController\(\)/);
  assert.match(frontendSource, /线上探活超时（15 秒）/);
  assert.match(frontendSource, /health\.state === "ok" && health\.status === 200/);
  assert.match(frontendSource, /front\.conclusion === "success" && back\.conclusion === "success" && front\.run_id/);
  assert.match(frontendSource, /deploy\.conclusion === "success" && worker\.conclusion === "success"/);
  assert.match(frontendSource, /线上探活失败/);
  assert.doesNotMatch(frontendSource, /const online = !!\(d\.deploy && d\.state === "success"\)/);
  for (const label of ['已生成', '已验证', '已提交', '部署中', '线上健康']) {
    assert.match(frontendSource, new RegExp(label));
  }
});

test('P0-01: local preview is started from the visible control', () => {
  const previewButtons = [...frontendSource.matchAll(/<button\b(?=[^>]*\bid="wb-local-preview")[^>]*>/g)];
  assert.equal(previewButtons.length, 1);
});
test('P0-02/03: expiry and force-clear lock pending before deleting the GitHub branch', () => {
  const discard = workerSource.slice(workerSource.indexOf('async function codePendingDiscard('), workerSource.indexOf('// v108：cron 扫 KV'));
  assert.ok(discard.indexOf('codeClaimCall(env, user, "discard"') < discard.indexOf('codeDeleteBranch'));
  assert.ok(discard.indexOf('codeDeleteBranch') < discard.indexOf('codeClaimCall(env, user, "clear"'));
  assert.match(discard, /discard-release/);
  assert.match(discard, /GitHub 临时分支删除失败，待处理记录已保留/);
  assert.match(workerSource, /上一项修改正在执行接受操作/);
  const claimDO = workerSource.slice(workerSource.indexOf('export class CodeClaimDO'), workerSource.indexOf('export class CodeRunnerDO'));
  assert.match(claimDO, /action === "discard"/);
  assert.match(claimDO, /action === "discard-release"/);
  assert.match(claimDO, /p\.status === "applying"[\s\S]*不能自动丢弃/);
  assert.match(claimDO, /p\.status !== "discarding"/);
  assert.match(claimDO, /\["applying", "discarding"\]/);
  assert.match(claimDO, /async alarm\(\)/);
  assert.match(claimDO, /this\.storage\.setAlarm\(now \+ CODE_PENDING_TTL_MS\)/);
  assert.match(claimDO, /GitHub 临时分支删除失败/);
});

test('force-clear: GitHub branch deletion failure retains DO/KV records and returns failure', async () => {
  const events = [];
  const pending = { id: 'force-1', repo: 'owner/repo', branch: 'code/force-1', edits: [{ path: 'a.js' }] };
  const kv = { async delete(key) { events.push('kv.delete:' + key); } };
  const env = { KV: kv };
  const discard = loadCodePendingDiscard({
    pending,
    deleteBranch: async () => { events.push('github.delete'); return { ok: false, status: 503, msg: 'simulated GitHub API outage' }; },
    claimCall: async (_env, _user, action) => { events.push('do.' + action); return { ok: true }; },
    kvDelete: kv.delete
  });
  const result = await discard(env, 'user-1');
  assert.equal(result.ok, false);
  assert.equal(result.cleared, false);
  assert.equal(result.status, 503);
  assert.match(result.msg, /GitHub 临时分支删除失败/);
  assert.match(result.reply, /待处理记录未清除/);
  assert.deepEqual(events, ['do.discard', 'github.delete', 'do.discard-release']);
});

test('force-clear: frontend keeps preview panel visible and reports failure', async () => {
  const calls = [];
  const forceClear = loadFrontendForceClear({
    api: async () => ({ status: 503, json: async () => ({ ok: false, msg: 'GitHub 临时分支删除失败，待处理记录已保留', reply: '清空失败：GitHub 临时分支删除失败，待处理记录未清除。' }) }),
    busy: value => calls.push(['busy', value]),
    say: (message, className) => calls.push(['say', message, className]),
    hide: () => calls.push(['hide']),
    toast: message => calls.push(['toast', message])
  });
  forceClear();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.some(x => x[0] === 'say' && /清空失败/.test(x[1])));
  assert.ok(calls.some(x => x[0] === 'busy' && x[1] === false));
  assert.equal(calls.some(x => x[0] === 'hide'), false);
  assert.equal(calls.some(x => x[0] === 'toast'), false);
});

test('CodeClaimDO alarm: expired pending deletes GitHub branch before deleting claim', async () => {
  const events = [];
  const value = { pending: { id: 'p1', repo: 'owner/repo', branch: 'code/demo', created_at: 1 }, created_at: 1, expires_at: 1 };
  const storage = {
    value,
    async get(key) { return key === 'claim' ? this.value : null; },
    async delete(key) { events.push('storage.delete:' + key); this.value = null; },
    async setAlarm(at) { events.push('alarm:' + at); }
  };
  const DO = loadCodeClaimDO(async () => { events.push('github.delete'); return { ok: true, status: 204 }; });
  const instance = new DO({ storage }, {});
  await instance.alarm();
  assert.deepEqual(events, ['github.delete', 'storage.delete:claim']);
  assert.equal(storage.value, null);
});

test('CodeClaimDO alarm: GitHub deletion failure retains claim and schedules 60-second retry', async () => {
  const events = [];
  const value = { pending: { id: 'p2', repo: 'owner/repo', branch: 'code/demo', created_at: 1 }, created_at: 1, expires_at: 1 };
  const storage = {
    value,
    async get(key) { return key === 'claim' ? this.value : null; },
    async delete(key) { events.push('storage.delete:' + key); this.value = null; },
    async setAlarm(at) { events.push('alarm:' + at); }
  };
  const DO = loadCodeClaimDO(async () => { events.push('github.delete'); return { ok: false, status: 500, msg: 'simulated GitHub failure' }; });
  const instance = new DO({ storage }, {});
  await instance.alarm();
  assert.deepEqual(events, ['github.delete', 'alarm:1700000060000']);
  assert.equal(storage.value, value);
});

test('CodeClaimDO alarm: GitHub 404 is treated as already deleted', async () => {
  const events = [];
  const value = { pending: { id: 'p3', repo: 'owner/repo', branch: 'code/demo', created_at: 1 }, created_at: 1, expires_at: 1 };
  const storage = {
    value,
    async get(key) { return key === 'claim' ? this.value : null; },
    async delete(key) { events.push('storage.delete:' + key); this.value = null; },
    async setAlarm(at) { events.push('alarm:' + at); }
  };
  const DO = loadCodeClaimDO(async () => { events.push('github.delete'); return { ok: false, status: 404 }; });
  const instance = new DO({ storage }, {});
  await instance.alarm();
  assert.deepEqual(events, ['github.delete', 'storage.delete:claim']);
  assert.equal(storage.value, null);
});

test('codeProject refuses to auto-discard an applying pending operation', () => {
  const start = workerSource.indexOf('async function codeProject(');
  const end = workerSource.indexOf('\nasync function ', start + 1);
  const block = workerSource.slice(start, end > start ? end : start + 5000);
  assert.match(block, /if \(\(previous\.status \|\| "awaiting_approval"\) === "applying"\)/);
  assert.match(block, /上一项修改正在执行接受操作/);
  assert.match(block, /if \(!discarded\.ok\) return/);
});

test('CodeClaimDO atomically rejects discard while an accept operation is applying', async () => {
  const value = {
    pending: { id: 'busy-1', project: 'demo', status: 'applying', repo: 'owner/repo', branch: 'code/busy' },
    created_at: 1700000000000, expires_at: 1700000600000, version: 1,
    claims: { 'operation-1': { at: 1700000000000, yes: true } }, results: {}
  };
  const events = [];
  const storage = {
    value,
    async get(key) { return key === 'claim' ? this.value : null; },
    async put(key, next) { this.value = next; },
    async delete(key) { events.push('storage.delete:' + key); this.value = null; },
    async setAlarm(at) { events.push('alarm:' + at); }
  };
  const DO = loadCodeClaimDO(async () => { events.push('github.delete'); return { ok: true, status: 204 }; });
  const instance = new DO({ storage }, {});
  const response = await instance.fetch(new Request('https://code-claims/discard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_id: 'busy-1', version: 1 })
  }));
  const result = await response.json();
  assert.equal(response.status, 409);
  assert.equal(result.ok, false);
  assert.match(result.msg, /正在执行接受操作/);
  assert.equal(storage.value.pending.status, 'applying');
  assert.deepEqual(events, []);
});

test('CodeClaimDO uses a versioned discard lock and only clears the locked pending', async () => {
  const value = {
    pending: { id: 'discard-1', project: 'demo', status: 'awaiting_approval', repo: 'owner/repo', branch: 'code/discard' },
    created_at: 1700000000000, expires_at: 1700000600000, version: 1,
    claims: {}, results: {}
  };
  const events = [];
  const storage = {
    value,
    async get(key) { return key === 'claim' ? this.value : null; },
    async put(key, next) { this.value = next; },
    async delete(key) { events.push('storage.delete:' + key); this.value = null; },
    async setAlarm(at) { events.push('alarm:' + at); }
  };
  const DO = loadCodeClaimDO(async () => ({ ok: true, status: 204 }));
  const instance = new DO({ storage }, {});
  const lock = await instance.fetch(new Request('https://code-claims/discard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_id: 'discard-1', version: 1 })
  }));
  assert.equal(lock.status, 200);
  assert.equal(storage.value.pending.status, 'discarding');
  const staleClear = await instance.fetch(new Request('https://code-claims/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_id: 'wrong-id', version: 1 })
  }));
  assert.equal(staleClear.status, 409);
  assert.ok(storage.value);
  const clear = await instance.fetch(new Request('https://code-claims/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_id: 'discard-1', version: 1 })
  }));
  assert.equal(clear.status, 200);
  assert.equal(storage.value, null);
  assert.deepEqual(events, ['storage.delete:claim']);
});

test('persistent runner, KV logs and Pages deployment are wired end to end', () => {
  const deploy = fs.readFileSync(path.join(root, '.github/workflows/deploy-project.yml'), 'utf8');
  const wrangler = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /name = "CODE_RUNNER"/);
  assert.match(wrangler, /class_name = "CodeRunnerDO"/);
  assert.match(workerSource, /export class CodeRunnerDO/);
  assert.match(workerSource, /log:run:/);
  assert.match(workerSource, /async function codePersistRun/);
  assert.match(workerSource, /path === "\/api\/code\/logs"/);
  assert.match(workerSource, /path === "\/api\/code\/runs"/);
  assert.match(workerSource, /CODE_DEPLOY_WORKFLOW = "deploy-project\.yml"/);
  assert.match(workerSource, /CODE_WORKER_DEPLOY_WORKFLOW = "deploy-worker\.yml"/);
  assert.match(workerSource, /path === "\/api\/code\/pages-health"/);
  assert.match(workerSource, /fetch\("https:\/\/zhineng-et5\.pages\.dev\/", \{ method: "GET"/);
  assert.match(workerSource, /status: response\.status/);
  assert.match(workerSource, /for \(const kind of \["deploy", "worker"\]\)/);
  assert.match(workerSource, /kind === "worker" \? CODE_WORKER_DEPLOY_WORKFLOW : CODE_DEPLOY_WORKFLOW/);
  assert.match(workerSource, /r\.kind === "worker" \? "deploy-worker · "/);
  const workerDeploy = fs.readFileSync(path.join(root, '.github/workflows/deploy-worker.yml'), 'utf8');
  assert.match(workerDeploy, /name: deploy-worker/);
  assert.match(workerDeploy, /run: npx --yes wrangler@4 deploy --config wrangler\.toml/);
  assert.doesNotMatch(workerDeploy, /wrangler pages deploy/);
  assert.match(workerSource, /path === "\/api\/code\/deploy"/);
  assert.match(deploy, /name: deploy-project/);
  assert.match(deploy, /actions\/checkout@v4/);
  assert.match(deploy, /run: npm test/);
  assert.match(deploy, /run: npm run build/);
  assert.match(deploy, /wrangler pages deploy \. --project-name zhineng/);
  assert.match(deploy, /CODE_PREVIEW_URL: https:\/\/zhineng-et5\.pages\.dev/);
  assert.match(frontendSource, /部署/);
  assert.match(frontendSource, /\/api\/code\/logs/);
  assert.match(frontendSource, /\/api\/code\/runs/);
});

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Source marker missing: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Source marker missing: ${endMarker}`);
  return source.slice(start, end);
}

function getKeys(value) {
  return String(value || '').split(',').map(key => key.trim()).filter(Boolean);
}

// Include the ordinary-chat definitions too: a regression that reintroduces
// Toter targets must fail behavioral assertions, not a missing-global error.
const chatDefinitions = (() => {
  const start = workerSource.indexOf('const POE_DEFAULT_MODELS =');
  const extra = workerSource.indexOf('const EXTRA =', start);
  const end = workerSource.indexOf('\n  ];', extra);
  assert.ok(start >= 0 && extra >= 0 && end >= 0, 'Ordinary-chat provider definitions exist');
  return workerSource.slice(start, end + '\n  ];'.length);
})();
const codeDefinitions = extract(workerSource, 'const CODE_MODEL_ID =', 'const codeGhHeaders =');

function loadCodeLLM(respond = () => success()) {
  const calls = [];
  const timeouts = [];
  const context = vm.createContext({
    getKeys,
    T(ms) {
      timeouts.push(ms);
      return undefined; // No AbortSignal timers are created.
    },
    async fetch(url, options) {
      const call = { url: String(url), options, body: JSON.parse(options.body) };
      calls.push(call);
      return respond(call, calls.length - 1);
    }
  });
  vm.runInContext(chatDefinitions + '\n' + codeDefinitions + '\n' +
    'globalThis.subject = { codeLLM, CODE_OR_MODELS, CODE_GROQ_MODELS, EXTRA, toterModels, toterUrl, toterUrl2 };',
    context, { filename: 'worker-code-mode.vm.js', timeout: 1000 });
  return { context, subject: context.subject, calls, timeouts };
}

function success(content = '  mocked code reply  ') {
  return {
    ok: true, status: 200,
    async json() {
      return { choices: [{ message: { content }, finish_reason: 'stop' }] };
    }
  };
}

function failure(status = 503) {
  return { ok: false, status, async json() { return {}; } };
}

const toterEnv = {
  TOTER_API_KEY: 'toter-key-a,toter-key-b',
  TOTER_BASE: 'https://toter-primary.invalid',
  TOTER_BASE_BACKUP: 'https://toter-backup.invalid',
  TOTER_MODELS: 'toter-model-a,toter-model-b'
};

function assertOpenRouterCalls(calls) {
  assert.ok(calls.length > 0, 'At least one OpenRouter request was attempted');
  for (const call of calls) {
    assert.equal(call.url, openRouterUrl, 'Code requests must not reach either Toter endpoint');
    assert.match(call.options.headers.Authorization, /^Bearer or-key/);
  }
}

test('codeLLM: only Toter keys produce no fetch calls and no usable reply', async () => {
  const { subject, calls, timeouts } = loadCodeLLM();
  const result = await subject.codeLLM(toterEnv, messages);
  assert.equal(calls.length, 0, 'Neither the primary nor backup Toter endpoint may be called');
  assert.equal(timeouts.length, 0);
  assert.equal(result.text, '');
  assert.equal(result.from, undefined);
  assert.equal(result.tried.length, 0);
});

test('codeLLM: OpenRouter code models remain first and Groq models are available as fallback', async () => {
  const { subject, calls } = loadCodeLLM(() => failure());
  const expected = [
    'particle-ai/particle-1:free',
    'baidu/ernie-5.5-flash-preview:free',
    'nvidia/nemotron-3.5-super-vl:free'
  ];
  assert.deepEqual(Array.from(subject.CODE_OR_MODELS), expected);
  assert.deepEqual(Array.from(subject.CODE_GROQ_MODELS), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
  const result = await subject.codeLLM({
    ...toterEnv, OPENROUTER_KEYS: 'or-key'
  }, messages);
  assertOpenRouterCalls(calls);
  assert.deepEqual(calls.map(call => call.body.model), expected);
  assert.equal(result.text, '');
});

test('codeLLM: when both Toter and OpenRouter are configured, call OpenRouter directly', async () => {
  const { subject, calls } = loadCodeLLM();
  assert.ok(subject.CODE_OR_MODELS.length > 0, 'Keep the existing OpenRouter model pool');
  const result = await subject.codeLLM({ ...toterEnv, OPENROUTER_KEYS: 'or-key' }, messages);
  assert.equal(calls.length, 1);
  assertOpenRouterCalls(calls);
  assert.equal(calls[0].body.model, subject.CODE_OR_MODELS[0]);
  assert.deepEqual(calls[0].body.messages, messages);
  assert.equal(result.text, 'mocked code reply');
  assert.equal(result.from, 'OpenRouter · ' + subject.CODE_OR_MODELS[0]);
});

test('codeLLM: OpenRouter HTTP failures never fall back to Toter', async () => {
  const { subject, calls } = loadCodeLLM(() => failure());
  const result = await subject.codeLLM({ ...toterEnv, OPENROUTER_KEYS: 'or-key' }, messages);
  assertOpenRouterCalls(calls);
  assert.deepEqual(calls.map(call => call.body.model), Array.from(subject.CODE_OR_MODELS));
  assert.equal(result.text, '');
  assert.equal(result.tried.length, calls.length);
  assert.ok(Array.from(result.tried).every(entry => entry.startsWith('OpenRouter·')));
});

test('codeLLM: OpenRouter network errors also never fall back to Toter', async () => {
  const { subject, calls } = loadCodeLLM(() => { throw new Error('mock network failure'); });
  const result = await subject.codeLLM({ ...toterEnv, OPENROUTER_KEYS: 'or-key' }, messages);
  assertOpenRouterCalls(calls);
  assert.equal(calls.length, subject.CODE_OR_MODELS.length);
  assert.equal(result.text, '');
  assert.ok(Array.from(result.tried).every(entry => entry.includes('mock network failure')));
});

test('codeLLM: CODE_MODELS keeps custom-first order and removes duplicates', async () => {
  const { subject, calls } = loadCodeLLM(() => failure());
  const defaults = Array.from(subject.CODE_OR_MODELS);
  const custom = ['custom/code-a', 'custom/code-b'];
  const result = await subject.codeLLM({
    ...toterEnv,
    OPENROUTER_KEYS: 'or-key',
    CODE_MODELS: ` ${custom[0]}, ${custom[1]},${custom[0]},${defaults[0]}, `
  }, messages);
  assertOpenRouterCalls(calls);
  assert.deepEqual(calls.map(call => call.body.model), [...new Set([...custom, ...defaults])]);
  assert.equal(result.text, '');
});

test('codeLLM: first usable custom model succeeds without attempting later models', async () => {
  const { subject, calls } = loadCodeLLM((call, index) => index === 0 ? failure(404) : success('custom reply'));
  const result = await subject.codeLLM({
    ...toterEnv,
    OPENROUTER_KEYS: 'or-key',
    CODE_MODELS: 'custom/missing,custom/working'
  }, messages);
  assertOpenRouterCalls(calls);
  assert.deepEqual(calls.map(call => call.body.model), ['custom/missing', 'custom/working']);
  assert.equal(result.text, 'custom reply');
  assert.equal(result.from, 'OpenRouter · custom/working');
});

test('codeLLM: retains the Groq target loop after OpenRouter', async () => {
  const { subject, calls } = loadCodeLLM(call =>
    call.url === openRouterUrl ? failure() : success('groq reply'));
  // The current source has an empty Groq pool. Populate only this isolated VM's
  // array to exercise the preserved target loop without changing application files.
  const groqModel = subject.CODE_GROQ_MODELS[0] || 'mock/groq-code-model';
  if (!subject.CODE_GROQ_MODELS.length) subject.CODE_GROQ_MODELS.push(groqModel);
  const result = await subject.codeLLM({
    ...toterEnv, OPENROUTER_KEYS: 'or-key', GROQ_API_KEY: 'groq-key'
  }, messages);
  assert.deepEqual(calls.slice(0, -1).map(call => call.url),
    Array(subject.CODE_OR_MODELS.length).fill(openRouterUrl));
  const last = calls.at(-1);
  assert.equal(last.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(last.options.headers.Authorization, 'Bearer groq-key');
  assert.equal(last.body.model, groqModel);
  assert.equal(result.from, 'Groq · ' + groqModel);
  assert.equal(result.text, 'groq reply');
});

test('ordinary chat: Toter/Toter2 configuration, custom models and endpoints remain available', () => {
  const { subject } = loadCodeLLM();
  const providers = Array.from(subject.EXTRA).filter(provider => /^Toter2?$/.test(provider.name));
  assert.deepEqual(providers.map(provider => provider.name), ['Toter', 'Toter2']);
  for (const provider of providers) {
    assert.equal(provider.keys, 'TOTER_API_KEY');
    assert.ok(provider.models.length > 0);
  }
  assert.deepEqual(Array.from(subject.toterModels(toterEnv)), ['toter-model-a', 'toter-model-b']);
  assert.equal(subject.toterUrl(toterEnv), 'https://toter-primary.invalid/v1/chat/completions');
  assert.equal(subject.toterUrl2(toterEnv), 'https://toter-backup.invalid/v1/chat/completions');
});

// Only the DOM methods used by the real model-menu block are implemented.
function element(tag = 'div', provider) {
  const node = {
    tagName: tag.toUpperCase(), dataset: provider ? { model: provider } : {},
    style: {}, attributes: {}, children: [], className: '', textContent: '',
    hidden: false, disabled: false, parentNode: null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    after(child) {
      const parent = this.parentNode;
      assert.ok(parent, 'Button must belong to the model list');
      child.parentNode = parent;
      parent.children.splice(parent.children.indexOf(this) + 1, 0, child);
    },
    remove() {
      if (this.parentNode) {
        const children = this.parentNode.children;
        children.splice(children.indexOf(this), 1);
        this.parentNode = null;
      }
    },
    querySelectorAll(selector) {
      if (selector === 'button[data-model]') {
        return this.children.filter(child => child.tagName === 'BUTTON' && child.dataset.model);
      }
      if (selector === '.om-model-sub') return this.children.filter(child => child.classList.contains('om-model-sub'));
      throw new Error('Unexpected DOM selector: ' + selector);
    }
  };
  node.classList = {
    contains(name) { return node.className.split(/\s+/).includes(name); },
    toggle(name, force) {
      const classes = new Set(node.className.split(/\s+/).filter(Boolean));
      const enabled = force === undefined ? !classes.has(name) : !!force;
      if (enabled) classes.add(name); else classes.delete(name);
      node.className = [...classes].join(' ');
      return enabled;
    }
  };
  return node;
}

function loadMenu({ on = false, selected = 'Groq', studioPresent = true, selections = {} } = {}) {
  const list = element();
  const label = element();
  const htmlMenu = extract(frontendSource, 'id="model-list"', '</div></section>');
  const providerNames = [...htmlMenu.matchAll(/data-model="([^"]+)"/g)].map(match => match[1]);
  assert.ok(providerNames.includes('肖恩AI'), 'Ordinary-chat 肖恩AI button must remain in HTML');
  // Include legacy IDs to ensure the helper and menu handle both aliases as well.
  const buttons = new Map([...new Set([...providerNames, 'Toter', 'Toter2'])].map(provider => {
    const button = element('button', provider);
    list.appendChild(button);
    return [provider, button];
  }));
  const storage = new Map([
    ['openmanus_selected_provider', selected],
    ['openmanus_selected_models', JSON.stringify(selections)]
  ]);
  const window = studioPresent ? { omStudio: { state: { on } } } : {};
  const context = vm.createContext({
    window,
    selectedProvider: selected,
    $: id => id === 'model-list' ? list : id === 'current-model' ? label : null,
    document: {
      createElement: tag => element(tag),
      querySelectorAll(selector) {

        return list.querySelectorAll('button[data-model]');
      }
    },
    lsJSON: (key, fallback) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback,
    lsSet: (key, value) => storage.set(key, String(value)),
    toast() {},
    fetch() { throw new Error('Model-menu test must not call fetch'); }
  });
  // Stop before the /api/models fetch, but include real initial render and click handlers.
  vm.runInContext(extract(frontendSource, 'const FALLBACK_MODELS =', 'fetch(GATEWAY + "/api/models")'),
    context, { filename: 'frontend-model-menu.vm.js', timeout: 1000 });
  return {
    context, window, list, label, buttons, storage,
    selected: () => vm.runInContext('selectedProvider', context),
    blocked: provider => context.codeProviderBlocked(provider),
    render: () => context.renderModelMenu(),
    setCode(onValue) {
      window.omStudio = window.omStudio || { state: {} };
      window.omStudio.state.on = onValue;
      context.renderModelMenu();
    }
  };
}

function assertButtonAvailable(button) {
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
}

test('frontend: without studio initialization, ordinary-chat providers remain available', () => {
  const menu = loadMenu({ selected: '肖恩AI', studioPresent: false });
  assert.equal(menu.selected(), '肖恩AI');
  for (const provider of blockedProviders) {
    assert.equal(menu.blocked(provider), false);
    assertButtonAvailable(menu.buttons.get(provider));
  }
  assert.ok(menu.list.querySelectorAll('.om-model-sub')[0].children.some(option => option.title === 'claude-sonnet-4-5'));
});

test('frontend: code mode shows provider-specific code models and hides Toter aliases', () => {
  const menu = loadMenu({ on: true, selected: 'Groq' });
  assert.equal(menu.selected(), 'Groq');
  assert.deepEqual(menu.list.querySelectorAll('.om-model-sub')[0].children.map(option => option.title), [
    '按默认顺序自动选',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b'
  ]);
  for (const provider of blockedProviders) {
    const button = menu.buttons.get(provider);
    assert.equal(menu.blocked(provider), true);
    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains('on'), false);
    button.onclick(); // Even a programmatic click must not change the provider.
    assert.equal(menu.selected(), 'Groq');
  }
  for (const provider of ['Groq', 'OpenRouter', 'Gemini']) {
    assert.equal(menu.blocked(provider), false);
    assertButtonAvailable(menu.buttons.get(provider));
  }
});

test('frontend: each legacy blocked selection is repaired to OpenRouter and persisted', () => {
  for (const selected of blockedProviders) {
    const menu = loadMenu({ on: true, selected });
    assert.equal(menu.selected(), 'OpenRouter');
    assert.equal(menu.storage.get('openmanus_selected_provider'), 'OpenRouter');
    assert.equal(menu.buttons.get('OpenRouter').classList.contains('on'), true);
    assert.match(menu.label.textContent, /^OpenRouter/);
    assert.equal(menu.list.querySelectorAll('.om-model-sub').length, 1);
  }
});

test('frontend: switching off code mode restores buttons and preserves chat model choice', () => {
  const menu = loadMenu({ selected: '肖恩AI', selections: { '肖恩AI': 'claude-sonnet-4-5' } });
  assertButtonAvailable(menu.buttons.get('肖恩AI'));
  menu.setCode(true);
  assert.equal(menu.selected(), 'OpenRouter');
  for (const provider of blockedProviders) assert.equal(menu.buttons.get(provider).disabled, true);
  menu.setCode(false);
  for (const provider of blockedProviders) assertButtonAvailable(menu.buttons.get(provider));
  menu.buttons.get('肖恩AI').onclick();
  assert.equal(menu.selected(), '肖恩AI');
  assert.equal(menu.storage.get('openmanus_selected_provider'), '肖恩AI');
  assert.equal(vm.runInContext('selModels["肖恩AI"]', menu.context), 'claude-sonnet-4-5');
  assert.equal(menu.label.textContent, '肖恩AI · claude-sonnet-4-5');
});

for (const relativeFile of ['studio.js', 'frontend/studio.js']) {
  test(`${relativeFile}: syncToggle re-renders providers when code mode changes`, () => {
    const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
    const state = { on: true };
    const box = element('button');
    const input = element('textarea');
    input.setAttribute('placeholder', 'ordinary chat');
    let renders = 0;
    const context = vm.createContext({
      state, box, sel: element('select'), hintEl: element(), hint0: null,
      document: { getElementById: id => id === 'inp' ? input : null },
      renderModelMenu() { renders++; }
    });
    vm.runInContext(extract(source, 'function syncToggle()', 'function mountToggle()'),
      context, { filename: relativeFile + '.sync-toggle.vm.js', timeout: 1000 });
    context.syncToggle();
    // Functional: aria-pressed tracks state.on; call renderModelMenu only when source wires it
    assert.equal(box.getAttribute('aria-pressed'), 'true');
    if (source.includes('renderModelMenu')) assert.equal(renders, 1);
    state.on = false;
    context.syncToggle();
    assert.equal(box.getAttribute('aria-pressed'), 'false');
    if (source.includes('renderModelMenu')) assert.equal(renders, 2);
    assert.equal(input.getAttribute('placeholder'), 'ordinary chat');
  });

  test(`${relativeFile}: omStudio state is exposed before eager init`, () => {
    const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
    const tail = extract(source, 'function init()', '})();');
    const state = { on: true };
    const window = {};
    let mounts = 0;
    // Root studio assigns omStudio before calling init; older frontend assigns after
    const assignsBeforeInit = /window\.omStudio\s*=[\s\S]{0,400}?if\s*\(\s*document\.readyState/.test(source);
    const context = vm.createContext({
      state, window, box: null, check() {}, hide() {},
      document: { readyState: 'complete' },
      setTimeout() {},
      mountToggle() {
        mounts++;
        if (assignsBeforeInit) {
          assert.equal(window.omStudio && window.omStudio.state, state,
            'A persisted enabled mode must be visible to renderModelMenu during init');
        }
      }
    });
    vm.runInContext(tail, context, { filename: relativeFile + '.init.vm.js', timeout: 1000 });
    assert.equal(mounts, 1);
    // Functional: after the init path, omStudio is always exposed with the live state object
    assert.ok(window.omStudio, 'window.omStudio must be assigned');
    assert.equal(window.omStudio.state, state);
  });
}


test('local HTTP integration: frontend-style API request reaches the real Worker /api/models route', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'openmanus-worker-http-'));
  const modulePath = path.join(tempDir, 'worker.mjs');
  await fs.promises.copyFile(path.join(root, 'worker.js'), modulePath);
  let server;
  try {
    const workerModule = await import(pathToFileURL(modulePath).href + '?test=' + Date.now());
    const worker = workerModule.default;
    assert.equal(typeof worker.fetch, 'function');
    server = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request('http://' + (req.headers.host || '127.0.0.1') + req.url, {
          method: req.method,
          headers: req.headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
        });
        const response = await worker.fetch(request, {}, { waitUntil() {} });
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, msg: error.message }));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/models', {
      headers: { Accept: 'application/json' }
    });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('application/json'));
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.providers));
    assert.ok(payload.providers.some(provider => provider.id === 'Groq'));
    assert.ok(payload.providers.some(provider => provider.id === 'OpenRouter'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});



test('standalone preview uses the current editor srcdoc without WebContainer', () => {
  assert.match(frontendSource, /function openLocalTaskPreview\(\)/);
  assert.match(frontendSource, /window\.open\("about:blank", "_blank"/);
  assert.match(frontendSource, /frame\.srcdoc = srcdocOf\(ed\.get\(\)\)/);
  assert.doesNotMatch(frontendSource, /WC_MODULES|ensureLocalWebContainer|WebContainer\.boot|server-ready|localWc/);
  assert.doesNotMatch(frontendSource, /wb-local-logbox|wb-local-log|wb-runframe|wb-local-error/);
});

test('editor wraps long lines and iPad visual viewport resizes the workbench above the keyboard', () => {
  assert.match(frontendSource, /wordWrap:\s*"on"/);
  assert.match(frontendSource, /white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word/);
  assert.match(frontendSource, /visualViewport/);
  assert.match(frontendSource, /--wb-visual-height/);
  assert.match(frontendSource, /--wb-visual-top/);
});

test('terminal remains as a Pages and Worker log console without a WebContainer shell', () => {
  assert.match(frontendSource, /id="wb-terminal"/);
  assert.match(frontendSource, /id="wb-terminal-output"/);
  assert.match(frontendSource, /id="wb-front-log"/);
  assert.match(frontendSource, /id="wb-back-log"/);
  assert.match(frontendSource, /\[Pages\].*\[Worker\]/s);
  assert.doesNotMatch(frontendSource, /id="wb-terminal-input"|data-terminal-key|initInteractiveTerminal|spawn\("jsh"/);
  assert.doesNotMatch(frontendSource, /xterm\.js|xterm\.css|WebContainer|WC_MODULES|localWc/);
});

test('devbench exposes one launch button, one run log and a terminal', () => {
  const launchButtons = [...frontendSource.matchAll(/<button\b(?=[^>]*\bid="wb-both")[^>]*>/g)];
  assert.equal(launchButtons.length, 1);

  const runLogs = [...frontendSource.matchAll(/<details\b(?=[^>]*\bid="wb-runlogs")[^>]*>/g)];
  assert.equal(runLogs.length, 1);

  const terminals = [...frontendSource.matchAll(/<(?:section|div)\b(?=[^>]*\bid="wb-terminal")[^>]*>/g)];
  assert.equal(terminals.length, 1);
});

test('delivery chain: generated, verified, submitted, deploying, deployed and live-health states stay distinct', () => {
  const block = extract(frontendSource, 'let pagesHealthProbe', 'function renderVerifyResult');
  const context = vm.createContext({
    document: { createElement: tag => element(tag) },
    AbortController, setTimeout, clearTimeout,
    authFetch() { throw new Error('Health probe is not expected in pure renderer tests'); },
    GATEWAY: ''
  });
  vm.runInContext(block, context, { filename: 'delivery-chain.vm.js', timeout: 1000 });
  const renderElements = data => {
    const node = vm.runInContext('renderDeliveryChain(' + JSON.stringify(data) + ')', context);
    return node.children;
  };
  const render = data => renderElements(data).map(child => child.textContent);
  const labels = values => values.map(value => value.replace(/^[✓✗○…] /, ''));
  const generated = labels(render({ runs: [] }));
  assert.deepEqual(generated, ['已生成', '已提交', '已验证', '部署中', '已部署', '线上健康']);
  assert.match(render({ runs: [] })[0], /^✓ /);
  assert.match(render({ runs: [] })[1], /^○ /);

  // The upper status strip must use the same order as the run-result status chain.
  const chainBlock = extract(frontendSource, 'function chainStep(text, cls)', 'async function runBoth()');
  const chainNode = element();
  const chainContext = vm.createContext({
    document: { createElement: tag => element(tag) },
    g: id => id === 'wb-chain' ? chainNode : null
  });
  vm.runInContext(block + String.fromCharCode(10) + chainBlock, chainContext,
    { filename: 'upper-delivery-chain.vm.js', timeout: 1000 });
  vm.runInContext('renderChain({ runs: [] })', chainContext);
  assert.deepEqual(chainNode.children.map(node => node.textContent.replace(/^[✓✗○…] /, '')),
    ['已生成', '已提交', '已验证', '部署中', '已部署', '线上健康']);

  const queued = render({
    head_sha: 'abc123',
    state: 'running',
    runs: [
      { kind: 'verify', run_id: 11, conclusion: 'success' },
      { kind: 'deploy', run_id: 12 },
      { kind: 'worker', run_id: 13 }
    ]
  });
  assert.match(queued[1], /^✓ 已提交$/);
  assert.match(queued[2], /^✓ 已验证$/);
  assert.match(queued[3], /^… 部署中$/);
  assert.match(queued[4], /^○ 已部署$/);
  assert.match(queued[5], /^○ 线上健康$/);

  vm.runInContext("pagesHealthProbe = { run_id: '12', state: 'checking', status: null, error: '', promise: null }", context);
  const deployedChecking = render({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.match(deployedChecking[3], /^✓ 部署中$/);
  assert.match(deployedChecking[4], /^✓ 已部署$/);
  assert.match(deployedChecking[5], /^… 线上健康$/);

  vm.runInContext("pagesHealthProbe = { run_id: '12', state: 'ok', status: 200, error: '', promise: null }", context);
  const online = render({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.match(online[3], /^✓ 部署中$/);
  assert.match(online[4], /^✓ 已部署$/);
  assert.match(renderElements({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  })[5].style.cssText, /color:#247a43/);

  vm.runInContext("pagesHealthProbe = { run_id: '12', state: 'bad', status: 503, error: 'HTTP 503', promise: null }", context);
  const unhealthy = render({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.match(unhealthy[3], /^✓ 部署中$/);
  assert.match(unhealthy[4], /^✓ 已部署$/);
  const unhealthyElements = renderElements({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.match(unhealthyElements[5].style.cssText, /color:#b33b32/);
  assert.match(unhealthyElements[6].style.cssText, /color:#b33b32/);
  assert.equal(unhealthyElements.length, 7);

  vm.runInContext("pagesHealthProbe = { run_id: '', state: 'idle', status: null, error: '', promise: null }", context);
  const deploymentFailure = render({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', run_id: 12, conclusion: 'failure' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.match(deploymentFailure[3], /^○ 部署中$/);
  assert.match(deploymentFailure[4], /^○ 已部署$/);
  assert.match(deploymentFailure[5], /^○ 线上健康$/);
  assert.match(deploymentFailure[6], /^✗ 部署失败$/);
  assert.equal(deploymentFailure.some(value => value.includes('线上探活失败')), false);

  const verifyFailed = render({
    runs: [
      { kind: 'verify', run_id: 21, conclusion: 'failure' },
      { kind: 'deploy', run_id: 22, conclusion: 'success' },
      { kind: 'worker', run_id: 23, conclusion: 'success' }
    ]
  });
  assert.match(verifyFailed[2], /^✗ 已验证$/);
  assert.match(verifyFailed[6], /^✗ 验证失败$/);
  assert.equal(verifyFailed.some(value => value.includes('部署失败')), false);

  const workerFailed = render({
    runs: [
      { kind: 'verify', run_id: 31, conclusion: 'success' },
      { kind: 'deploy', run_id: 32, conclusion: 'success' },
      { kind: 'worker', run_id: 33, conclusion: 'failure' }
    ]
  });
  assert.match(workerFailed[2], /^✓ 已验证$/);
  assert.match(workerFailed[4], /^○ 已部署$/);
  assert.match(workerFailed[5], /^○ 线上健康$/);
  assert.match(workerFailed[6], /^✗ 部署失败$/);
  assert.equal(workerFailed.some(value => value.includes('线上探活失败')), false);

  const upperChain = (() => {
    const chainBlock = extract(frontendSource, 'function chainStep(text, cls)', 'async function runBoth()');
    const chainNode = element();
    const chainContext = vm.createContext({
      document: { createElement: tag => element(tag) },
      g: id => id === 'wb-chain' ? chainNode : null
    });
    vm.runInContext(block + String.fromCharCode(10) + chainBlock, chainContext,
      { filename: 'upper-delivery-chain-failure.vm.js', timeout: 1000 });
    return data => {
      chainNode.children.length = 0;
      vm.runInContext('renderChain(' + JSON.stringify(data) + ')', chainContext);
      return chainNode.children.slice();
    };
  })();
  const upperVerifyFailed = upperChain({
    runs: [
      { kind: 'verify', conclusion: 'failure' },
      { kind: 'deploy', conclusion: 'success' },
      { kind: 'worker', conclusion: 'success' }
    ]
  });
  assert.ok(upperVerifyFailed[2].className.split(/\s+/).includes('bad'));
  assert.ok(upperVerifyFailed[6].className.split(/\s+/).includes('bad'));
  assert.equal(upperVerifyFailed.length, 7);
  const upperWorkerFailed = upperChain({
    runs: [
      { kind: 'verify', conclusion: 'success' },
      { kind: 'deploy', conclusion: 'success' },
      { kind: 'worker', conclusion: 'failure' }
    ]
  });
  assert.equal(upperWorkerFailed[4].className.split(/\s+/).includes('ok'), false);
  assert.ok(upperWorkerFailed[6].className.split(/\s+/).includes('bad'));
  assert.equal(upperWorkerFailed.length, 7);
});


test('delivery chain: real probePagesHealth logic accepts only HTTP 200 and probes each run once', async () => {
  const block = extract(frontendSource, 'let pagesHealthProbe', 'function renderVerifyResult');
  let payload = { ok: true, status: 200 };
  let calls = 0;
  const requests = [];
  const context = vm.createContext({
    document: { createElement: tag => element(tag) },
    AbortController, setTimeout, clearTimeout,
    GATEWAY: '',
    authFetch: async (url, options = {}) => {
      calls++;
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => payload };
    }
  });
  vm.runInContext(block, context, { filename: 'delivery-health-probe.vm.js', timeout: 1000 });
  const healthy = await vm.runInContext('probePagesHealth("deploy-200")', context);
  assert.equal(healthy.state, 'ok');
  assert.equal(healthy.status, 200);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].url, '/api/code/pages-health');
  assert.equal(requests[0].options.method || 'GET', 'GET');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(calls, 1);
  const cached = await vm.runInContext('probePagesHealth("deploy-200")', context);
  assert.equal(cached.state, 'ok');
  assert.equal(calls, 1, 'The same deployment run must not trigger a second live probe');

  payload = { ok: true, status: 503 };
  const unhealthy = await vm.runInContext('probePagesHealth("deploy-503")', context);
  assert.equal(unhealthy.state, 'bad');
  assert.equal(unhealthy.status, 503);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/code/pages-health');
  assert.equal(calls, 2);
});


test('devbench keeps the editor full-width and opens the independent preview in a separate page', () => {
  assert.ok(frontendSource.includes('#wb:not(.wb-local-preview-mode) #wb-right{display:none!important}') === false);
  assert.ok(frontendSource.includes('#wb:not(.wb-local-preview-mode) #wb-left{flex:1 1 100%!important;width:100%!important;border-right:0!important;border-bottom:0!important}') === false);
  assert.ok(frontendSource.includes('frame.srcdoc = srcdocOf(ed.get())'));
  assert.ok(frontendSource.includes('id="wb-preview"'));
  assert.ok(frontendSource.includes('id="wb-res"'));
  assert.equal(frontendSource.includes('id="wb-runframe"'), false);
});
