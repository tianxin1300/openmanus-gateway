'use strict';

// Run from any directory: node --test /path/to/tests/code-mode-providers.test.cjs
// Evaluate the real source in isolated VMs. All fetches, timers and DOM APIs are
// mocked; this file does not import/start the Worker or contact any API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, 'studio.js'), 'utf8');
const frontendStudioSource = fs.readFileSync(path.join(root, 'frontend/studio.js'), 'utf8');
const blockedProviders = ['肖恩AI', 'Toter', 'Toter2'];
const messages = [{ role: 'user', content: 'Write a small function.' }];
const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

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
