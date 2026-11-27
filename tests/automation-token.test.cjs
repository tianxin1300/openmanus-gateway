'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');

test('正常登录令牌仍使用原来的 30 天 TTL', () => {
  assert.match(worker, /async function newToken\(env, user\)[\s\S]*?env\.KV\.put\("token:" \+ token, user, \{ expirationTtl: 30 \* 24 \* 3600 \}\)/);
});

test('Cron 自动化令牌单独存储且不设置 KV 自动过期', () => {
  assert.match(worker, /const token = "omcron_" \+ rand\(32\)/);
  assert.match(worker, /env\.KV\.put\("automation_token:" \+ hash, user\)/);
  assert.doesNotMatch(worker, /env\.KV\.put\("automation_token:" \+ hash, user, \{\s*expirationTtl/);
  assert.match(worker, /automation_token_index:/);
});

test('Cron 令牌只可通过 Bearer 调用 POST /v1/chat/completions', () => {
  assert.match(worker, /bearer\.startsWith\("omcron_"\)[\s\S]*?request\.method !== "POST" \|\| url\.pathname !== "\/v1\/chat\/completions"/);
  assert.ok(worker.includes("if (/^Bearer\\s+omcron_/.test(authHeader)"));
  assert.match(worker, /自动化令牌无效或已撤销/);
});

test('自动化令牌管理要求正常登录，并支持查看、轮换和撤销', () => {
  const start = worker.indexOf('if (path === "/api/automation-token"');
  const end = worker.indexOf('// ---- 账号', start);
  const route = worker.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /userFromReq\(request, env, url\)/);
  assert.match(route, /request\.method === "GET"/);
  assert.match(route, /\["GET", "POST", "DELETE"\]/);
  assert.match(route, /request\.method === "DELETE"/);
  assert.match(route, /env\.KV\.delete\("automation_token:" \+ current\.hash\)/);
});

test('个人中心提供独立 Cron 令牌生成、复制、撤销，不保存到本地存储', () => {
  assert.match(frontend, /Cron Issue Agent 自动化令牌/);
  assert.match(frontend, /生成 Cron 专用长期令牌/);
  assert.match(frontend, /复制自动化令牌/);
  assert.match(frontend, /撤销自动化令牌/);
  assert.match(frontend, /仅授权 POST \/v1\/chat\/completions/);
  assert.doesNotMatch(frontend, /localStorage\.setItem\([^\n]*automation/i);
});

test('PR 60 Pages preview may target only its dedicated preview Worker', () => {
  assert.match(frontend, /location\.hostname\.endsWith\("\.pages\.dev"\)/);
  assert.match(frontend, /openmanus-gateway-pr60-preview/);
});

  assert.ok(frontend.includes('workers\\.dev'));