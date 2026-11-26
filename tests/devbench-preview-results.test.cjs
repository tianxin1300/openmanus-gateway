"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("devbench keeps expandable logs and both independent preview regions", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
  const match = /<script\\b(?=[^>]*\\bid=["']wb-devbench["'])[^>]*>([\\s\\S]*?)<\\/script\\s*>/i.exec(html);
  assert.ok(match, "the wb-devbench script must exist");
  assert.doesNotThrow(() => new vm.Script(match[1]), "the devbench script must parse");

  assert.match(match[1], /g\\(["']wb-runlogs["']\\)\\.addEventListener\\(["']toggle["']/,
    "opening and closing the run-log card must update its layout");
  assert.match(match[1], /local-preview-frame/,
    "the independent preview page must retain its preview iframe");
  assert.match(match[1], /local-run-result-content/,
    "the independent preview page must retain its run-result region");
  assert.match(match[1], /syncLocalTaskPreview\\(\\)/,
    "preview and run results must be synchronized after updates");
  assert.match(html, /#wb-term\\.wb-runlogs-expanded/,
    "the iPad layout must allocate extra space when run logs are expanded");
});
