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

// PLACEHOLDER_FULL_CONTENT
