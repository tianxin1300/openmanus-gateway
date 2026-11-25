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
const studioSource = fs.readFileSync(path.join(root, 'frontend/studio.js'), 'utf8');
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
  assert.match(workerSource, /<conversation_agency>[\s\S]*自然对话与自主推进/);
  assert.match(workerSource, /不要把每一轮都套成固定/);
  assert.match(workerSource, /只有存在会影响使用的重要不确定性或风险时才说明/);
  assert.match(workerSource, /reply: r\.text \+ \(notes\.length \? "\\n\\n" \+ notes\.join\("\\n"\) : ""\) \};/);
  assert.doesNotMatch(workerSource, /直接回答就行，我接着改。\\n\\n（" \+ model \+ "）/);
  assert.match(frontendSource, /\(m\.notes \|\| \[\]\)\.filter\(n =>/);
  assert.match(frontendSource, /模型切换、联网成功、来源统计等内部状态不混进正文/);
});

test('editor delivery: pending work is resumable and deployment state is not overstated', () => {
  assert.match(workerSource, /status: "awaiting_approval"/);
  assert.match(workerSource, /status = "partial"/);
  assert.match(workerSource, /已保留未成功的文件修改，可以重试/);
  assert.match(workerSource, /consumed: true, status: "applied"/);
  assert.match(studioSource, /状态暂时无法确认，修改仍保留，请稍后重试/);
  assert.doesNotMatch(studioSource, /Cloudflare 会自动重新部署/);
  assert.match(studioSource, /p\.project \|\| state\.project/);
});

test('web workbench: refuses unsafe save and recognizes dev/test/build scripts', () => {
  assert.match(frontendSource, /没有拿到文件基线 SHA，为避免覆盖线上改动/);
  assert.match(frontendSource, /const scripts = pkg && pkg\.scripts \|\| \{\}/);
  assert.match(frontendSource, /\["test", "build"\]/);
  assert.match(frontendSource, /scripts\.dev \? "dev" : scripts\.start \? "start"/);
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

test('remote verification UI: green success, red failures, and no invented preview URL', () => {
  assert.match(frontendSource, /验证通过/);
  assert.match(frontendSource, /验证失败/);
  assert.match(frontendSource, /d\.error_lines/);
  assert.match(frontendSource, /verifyLink\("打开项目预览", d\.preview_url\)/);
  assert.match(frontendSource, /没有配置真实公网预览部署地址/);
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
        assert.equal(selector, '#model-list button[data-model]');
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
  assert.equal(button.style.display, '');
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
    assert.equal(button.style.display, 'none');
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
    assert.equal(renders, 1);
    assert.equal(box.getAttribute('aria-pressed'), 'true');
    state.on = false;
    context.syncToggle();
    assert.equal(renders, 2);
    assert.equal(box.getAttribute('aria-pressed'), 'false');
    assert.equal(input.getAttribute('placeholder'), 'ordinary chat');
  });

  test(`${relativeFile}: omStudio state is exposed before eager init`, () => {
    const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
    const tail = extract(source, 'function init()', '})();');
    const state = { on: true };
    const window = {};
    let mounts = 0;
    const context = vm.createContext({
      state, window, box: null, check() {}, hide() {},
      document: { readyState: 'complete' },
      setTimeout() {},
      mountToggle() {
        mounts++;
        assert.equal(window.omStudio && window.omStudio.state, state,
          'A persisted enabled mode must be visible to renderModelMenu during init');
      }
    });
    vm.runInContext(tail, context, { filename: relativeFile + '.init.vm.js', timeout: 1000 });
    assert.equal(mounts, 1);
    assert.equal(window.omStudio.state, state);
  });
}
