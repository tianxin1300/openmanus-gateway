'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
const profileStart = source.indexOf('if (view === "profile")');
const profileEnd = source.indexOf('} else if (view === "billing")', profileStart);
const profile = source.slice(profileStart, profileEnd);

test('个人资料页显示当前登录令牌全文', () => {
  assert.ok(profileStart >= 0 && profileEnd > profileStart, 'profile settings view exists');
  assert.match(profile, /登录令牌/);
  assert.match(profile, /tokenValue\.value = authToken/);
  assert.match(profile, /tokenValue\.readOnly = true/);
  assert.match(profile, /setAttribute\("aria-label", "当前登录令牌"\)/);
});

test('令牌复制按钮使用现有复制能力，不把令牌放入 URL', () => {
  assert.match(profile, /setBtn\("复制", \(\) => copy\(authToken\)/);
  assert.doesNotMatch(profile, /location\.(?:href|search)|URLSearchParams/);
  assert.doesNotMatch(profile, /console\.(?:log|info|warn|error).*authToken/);
});

test('令牌缺失时只引导走原有登录流程，不自行生成或改写认证逻辑', () => {
  assert.match(profile, /重新登录并生成令牌/);
  assert.match(profile, /showAuth\("请登录当前账号以生成新的登录令牌"\)/);
  assert.doesNotMatch(profile, /fetch\([^\n]*api\/(?:login|register)/);
  assert.doesNotMatch(profile, /setAuthToken\s*\(/);
});

test('令牌展示控件支持手机端手动选择复制', () => {
  assert.match(source, /-webkit-user-select:text;user-select:text/);
  assert.match(profile, /tokenValue\.spellcheck = false/);
});
