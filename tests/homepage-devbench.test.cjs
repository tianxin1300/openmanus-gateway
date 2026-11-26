"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("homepage devbench script parses and registers the open button handler", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
  const match = /<script\\b(?=[^>]*\\bid=["']wb-devbench["'])[^>]*>([\\s\\S]*?)<\\/script\\s*>/i.exec(html);

  assert.ok(match, "the wb-devbench script must exist");
  assert.doesNotThrow(
    () => new vm.Script(match[1], { filename: "frontend/index.html#wb-devbench" }),
    "the devbench script must be valid JavaScript so its event listeners can register"
  );
  assert.match(match[1], /g\\(["']wb-open["']\\)\\.addEventListener\\(["']click["']/,
    "the development-workbench button must keep its click handler");
});
