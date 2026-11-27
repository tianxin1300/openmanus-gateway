const { test, expect } = require("@playwright/test");

const REPO = "tianxin1300/openmanus-gateway";
const BRANCH = "code/playwright-ui-fixture";
const MCP_URL = "https://my-github-mcp.tianxinyuan881.workers.dev/mcp";

function fixtures() {
  return {
    active: false,
    changes: [
      { path: "frontend/studio.js", status: "modified", additions: 3, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" },
      { path: "README.md", status: "modified", additions: 2, deletions: 0, patch: "@@ -1 +1 @@\n-old\n+new" }
    ],
    history: [],
    rejected: [],
    mergePayload: null,
    discardPayload: null,
    rollbackPayload: null,
    createCount: 0
  };
}

async function installApiFixtures(page, state) {
  await page.route("**/api/history", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, history: [] }) }));

  await page.route("**/api/code/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === "POST" ? (req.postDataJSON() || {}) : {};
    const json = data => route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(data)
    });

    if (path.endsWith("/branch/current")) {
      return json(state.active
        ? { ok: true, active: true, repo: REPO, branch: BRANCH, baseBranch: "main", baseCommit: "base-sha", project: "openmanus-gateway" }
        : { ok: true, active: false });
    }
    if (path.endsWith("/branch/create") && method === "POST") {
      state.active = true;
      state.createCount++;
      return json({ ok: true, active: true, repo: REPO, branch: BRANCH, baseBranch: "main", baseCommit: "base-sha", project: "openmanus-gateway" });
    }
    if (path.endsWith("/tree")) {
      return json({ ok: true, files: ["frontend/index.html", "frontend/studio.js", "README.md"] });
    }
    if (path.endsWith("/branch/diff")) {
      return json({ ok: true, files: state.changes });
    }
    if (path.endsWith("/branch/reject-file") && method === "POST") {
      state.rejected.push(body.path);
      state.changes = state.changes.filter(file => file.path !== body.path);
      return json({ ok: true, rejected: body.path });
    }
    if (path.endsWith("/history")) {
      return json({ ok: true, history: state.history });
    }
    if (path.endsWith("/branch/merge") && method === "POST") {
      state.mergePayload = body;
      state.active = false;
      state.history.unshift({
        id: "history-after-push",
        repo: REPO,
        commit_sha: "a".repeat(40),
        at: "2026-11-27T12:00:00Z",
        summary: "Playwright UI push",
        files: body.accepted_paths || []
      });
      return json({ ok: true, merged: true, branch_deleted: true, reply: "已合并到 main" });
    }
    if (path.endsWith("/branch/discard") && method === "POST") {
      state.discardPayload = body;
      state.active = false;
      return json({ ok: true, main_untouched: true, reply: "临时分支已删除，main 未改变。" });
    }
    if (path.endsWith("/rollback") && method === "POST") {
      state.rollbackPayload = body;
      state.active = false;
      return json({ ok: true, reply: "回滚提交已创建" });
    }
    return json({ ok: false, msg: "Unexpected Playwright API request: " + method + " " + path });
  });

  await page.route(MCP_URL, async route => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, mcp-session-id"
      }});
    }
    const rpc = req.postDataJSON() || {};
    let result = {};
    if (rpc.method === "tools/list") {
      result = { tools: [{
        name: "get_file",
        inputSchema: { type: "object", properties: {
          owner: { type: "string" }, repo: { type: "string" },
          path: { type: "string" }, branch: { type: "string" }
        }}
      }]};
    } else if (rpc.method === "tools/call") {
      result = { content: [{ type: "text", text: JSON.stringify({
        content: "<!doctype html><html><body>Playwright preview fixture</body></html>",
        sha: "fixture-blob-sha"
      })}]};
    }
    if (!rpc.id) return route.fulfill({ status: 202, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "mcp-session-id": "playwright-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })
    });
  });
}

async function openWorkbench(page) {
  await page.goto("/");
  await page.locator("#wb-open").click();
  await expect(page.locator("#wb")).toBeVisible();
  await expect(page.locator("#wb-branch")).toContainText("code/");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("openmanus_token", "playwright-ui-token"));
  page.on("dialog", dialog => dialog.accept());
});

test("file review, reject one file, accept another, and push only accepted paths", async ({ page }) => {
  const state = fixtures();
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const rejectedRow = page.locator(".wb-change-row").filter({ hasText: "frontend/studio.js" });
  await expect(rejectedRow).toBeVisible();
  await rejectedRow.getByRole("button", { name: "拒绝" }).click();
  await expect.poll(() => state.rejected).toEqual(["frontend/studio.js"]);
  await expect(page.locator(".wb-change-row").filter({ hasText: "frontend/studio.js" })).toHaveCount(0);

  const acceptedRow = page.locator(".wb-change-row").filter({ hasText: "README.md" });
  await acceptedRow.getByRole("button", { name: "接受" }).click();
  await expect(acceptedRow.getByRole("button", { name: "已接受" })).toBeVisible();

  await page.locator("#wb-push").click();
  await expect.poll(() => state.mergePayload).not.toBeNull();
  expect(state.mergePayload.accepted_paths).toEqual(["README.md"]);
  await expect(page.locator("#wb-branch")).toContainText("无活动临时分支");
  await expect(page.locator("#wb-version-list")).toContainText("Playwright UI push");
});

test("discard preserves main, then history rollback creates a new active branch", async ({ page }) => {
  const state = fixtures();
  state.history = [{
    id: "history-before-rollback",
    repo: REPO,
    commit_sha: "b".repeat(40),
    at: "2026-11-26T10:00:00Z",
    summary: "previous stable version",
    files: ["frontend/studio.js"]
  }];
  await installApiFixtures(page, state);
  await openWorkbench(page);

  await page.locator("#wb-discard").click();
  await expect.poll(() => state.discardPayload).not.toBeNull();
  expect(state.discardPayload.branch).toBe(BRANCH);
  await expect(page.locator("#wb-branch")).toContainText("无活动临时分支");

  await page.locator("#wb-version-details > summary").click();
  const version = page.locator(".wb-version-row").filter({ hasText: "previous stable version" });
  await expect(version).toBeVisible();
  const rollback = version.getByRole("button", { name: "回滚" });
  await expect(rollback).toBeEnabled();
  await rollback.click();

  await expect.poll(() => state.rollbackPayload).toEqual({ id: "history-before-rollback" });
  await expect(page.locator("#wb-branch")).toContainText("code/");
  expect(state.createCount).toBe(2);
});
