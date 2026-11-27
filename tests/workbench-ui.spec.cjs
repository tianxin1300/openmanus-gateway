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
    rejectFailuresRemaining: 0,
    mergeFailure: false,
    mergePartialFailure: "",
    mergeCalls: 0,
    actualGitHubMergeCount: 0,
    branchStatus: "active",
    discardFailure: false,
    discardAuditFailuresRemaining: 0,
    discardCalls: 0,
    history: [],
    rejected: [],
    rejectedPayloads: [],
    rejectAttempts: [],
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
    const json = (data, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(data)
    });

    if (path.endsWith("/branch/current")) {
      return json(state.active
        ? { ok: true, active: true, repo: REPO, branch: BRANCH, baseBranch: "main", baseCommit: "base-sha", project: "openmanus-gateway", status: state.branchStatus }
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
      state.rejectAttempts.push(body);
      if (state.rejectFailuresRemaining > 0) {
        state.rejectFailuresRemaining--;
        if (body.previous_path) state.renameSourceRestored = true;
        return json({ ok: false, msg: "simulated destination deletion failure after source restoration" }, 500);
      }
      if (body.previous_path) state.renameDestinationDeleted = true;
      state.rejected.push(body.path);
      state.rejectedPayloads.push(body);
      state.changes = state.changes.filter(file => file.path !== body.path);
      return json({ ok: true, rejected: body.path });
    }
    if (path.endsWith("/history")) {
      return json({ ok: true, history: state.history });
    }
    if (path.endsWith("/branch/merge") && method === "POST") {
      state.mergePayload = body;
      state.mergeCalls++;
      if (state.mergeFailure) {
        return json({ ok: false, msg: "main advanced during review", conflict: true, files: ["README.md"] }, 409);
      }
      if (state.mergePartialFailure && state.mergeCalls === 1) {
        state.actualGitHubMergeCount++;
        state.branchStatus = state.mergePartialFailure;
        return json({
          ok: false,
          merged: true,
          branch_deleted: false,
          history_saved: state.mergePartialFailure !== "merged_history_failed",
          msg: state.mergePartialFailure === "merged_history_failed"
            ? "GitHub 已合并，但历史记录保存失败；临时分支已保留"
            : "已合并到 main，但删除临时分支失败"
        }, 400);
      }
      state.active = false;
      if (!state.mergePartialFailure) state.actualGitHubMergeCount++;
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
      state.discardCalls++;
      if (state.discardFailure) {
        return json({ ok: false, msg: "simulated branch deletion failure" }, 503);
      }
      if (state.discardAuditFailuresRemaining > 0) {
        state.discardAuditFailuresRemaining--;
        state.active = false;
        return json({ ok: false, discarded: true, branch_deleted: true, audit_saved: false, msg: "临时分支已删除，但操作者审计记录写入失败" }, 400);
      }
      state.active = false;
      state.history.unshift({ id: "workbench-discard-" + BRANCH, kind: "workbench_discard", action: "discard", actor: "playwright-user", repo: REPO, branch: BRANCH, at: "2026-11-27T14:00:00Z" });
      return json({ ok: true, main_untouched: true, audit_saved: true, reply: "临时分支已删除，main 未改变。" });
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("openmanus_token", "playwright-ui-token"));
  await page.reload({ waitUntil: "domcontentloaded" });
  // Auth is intentionally stubbed in this isolated UI harness; keep the real workbench UI unobstructed.
  // Keep auth out of this isolated workbench UI suite. WebKit can complete
  // the page's auth initialization after the evaluate() callback, so enforce
  // the harness-only hidden state with a page style instead of racing its class.
  await page.addStyleTag({ content: "#auth-mask { display: none !important; }" });
  await page.evaluate(() => {
    const mask = document.getElementById("auth-mask");
    if (mask) mask.classList.add("hidden");
    document.body.classList.remove("auth-locked");
  });
  await expect(page.locator("#auth-mask")).toBeHidden();
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

test("rejecting a renamed file sends the previous filename so the source path can be restored", async ({ page }) => {
  const state = fixtures();
  state.changes = [{
    path: "new-name.js",
    previous_path: "old-name.js",
    status: "renamed",
    additions: 1,
    deletions: 1,
    patch: "@@ rename"
  }];
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const row = page.locator(".wb-change-row").filter({ hasText: "new-name.js" });
  await row.getByRole("button", { name: "拒绝" }).click();
  await expect.poll(() => state.rejectedPayloads.length).toBe(1);
  expect(state.rejectedPayloads[0]).toMatchObject({
    path: "new-name.js",
    previous_path: "old-name.js",
    branch: BRANCH
  });
  await expect(row).toHaveCount(0);
});

test("failed renamed-file rejection keeps the row retryable after restoring its source path", async ({ page }) => {
  const state = fixtures();
  state.rejectFailuresRemaining = 1;
  state.changes = [{
    path: "new-name.js",
    previous_path: "old-name.js",
    status: "renamed",
    additions: 1,
    deletions: 1,
    patch: "@@ rename"
  }];
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const row = page.locator(".wb-change-row").filter({ hasText: "new-name.js" });
  const reject = row.getByRole("button", { name: "拒绝" });
  await reject.click();

  await expect.poll(() => state.rejectAttempts.length).toBe(1);
  expect(state.rejectAttempts[0]).toMatchObject({
    path: "new-name.js",
    previous_path: "old-name.js",
    branch: BRANCH
  });
  expect(state.renameSourceRestored).toBe(true);
  expect(state.renameDestinationDeleted).toBeUndefined();
  await expect(row).toBeVisible();
  await expect(reject).toBeEnabled();

  await reject.click();
  await expect.poll(() => state.rejectAttempts.length).toBe(2);
  expect(state.rejectAttempts[1]).toMatchObject({
    path: "new-name.js",
    previous_path: "old-name.js",
    branch: BRANCH
  });
  await expect.poll(() => state.renameDestinationDeleted).toBe(true);
  await expect(row).toHaveCount(0);
});

test("terminal and run-log tabs switch exclusively and follow mobile viewport resizing", async ({ page }) => {
  const state = fixtures();
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const terminalTab = page.locator("#wb-terminal-tab");
  const logsTab = page.locator("#wb-runlogs-tab");
  const terminal = page.locator("#wb-terminal");
  const logs = page.locator("#wb-runlogs");

  await expect(terminalTab).toHaveAttribute("aria-selected", "true");
  await expect(logsTab).toHaveAttribute("aria-selected", "false");
  await expect(terminal).toBeVisible();
  await expect(logs).toBeHidden();

  await logsTab.click();
  await expect(logsTab).toHaveAttribute("aria-selected", "true");
  await expect(terminalTab).toHaveAttribute("aria-selected", "false");
  await expect(logs).toBeVisible();
  await expect(terminal).toBeHidden();

  await terminalTab.click();
  await expect(terminalTab).toHaveAttribute("aria-selected", "true");
  await expect(logsTab).toHaveAttribute("aria-selected", "false");
  await expect(terminal).toBeVisible();
  await expect(logs).toBeHidden();

  const viewportMatchesLayout = async () => page.evaluate(() => {
    const viewport = window.visualViewport;
    const height = Math.max(240, viewport ? viewport.height : window.innerHeight);
    const top = Math.max(0, viewport ? viewport.offsetTop : 0);
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue("--wb-visual-height").trim() === height + "px"
      && style.getPropertyValue("--wb-visual-top").trim() === top + "px";
  });
  await expect.poll(viewportMatchesLayout).toBe(true);

  await page.setViewportSize({ width: 390, height: 640 });
  await expect.poll(viewportMatchesLayout).toBe(true);
});

test("merged history recovery remains retryable after reload without a second GitHub merge", async ({ page }) => {
  const state = fixtures();
  state.mergePartialFailure = "merged_history_failed";
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const acceptedRow = page.locator(".wb-change-row").filter({ hasText: "README.md" });
  await acceptedRow.getByRole("button", { name: "接受" }).click();
  await page.locator("#wb-push").click();
  await expect.poll(() => state.mergeCalls).toBe(1);
  await expect(page.getByText("已合并到 main，恢复处理待完成")).toBeVisible();
  await expect(page.locator("#wb-branch")).toContainText("code/");
  expect(state.actualGitHubMergeCount).toBe(1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await openWorkbench(page);
  await expect(page.locator("#wb-branch")).toContainText("code/");
  await page.locator("#wb-push").click();
  await expect.poll(() => state.mergeCalls).toBe(2);
  await expect(page.locator("#wb-branch")).toContainText("无活动临时分支");
  expect(state.actualGitHubMergeCount).toBe(1);
});

test("failed file rejection keeps the diff visible and allows a successful retry", async ({ page }) => {
  const state = fixtures();
  state.rejectFailuresRemaining = 1;
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const row = page.locator(".wb-change-row").filter({ hasText: "frontend/studio.js" });
  const reject = row.getByRole("button", { name: "拒绝" });
  await reject.click();
  await expect(row).toBeVisible();
  await expect(reject).toBeEnabled();
  expect(state.rejected).toEqual([]);

  await reject.click();
  await expect.poll(() => state.rejected).toEqual(["frontend/studio.js"]);
  await expect(row).toHaveCount(0);
  await expect(page.locator("#wb-branch")).toContainText("code/");
});

test("merge conflict keeps the temporary branch and accepted diff available", async ({ page }) => {
  const state = fixtures();
  state.mergeFailure = true;
  await installApiFixtures(page, state);
  await openWorkbench(page);

  const acceptedRow = page.locator(".wb-change-row").filter({ hasText: "README.md" });
  await acceptedRow.getByRole("button", { name: "接受" }).click();
  await page.locator("#wb-push").click();

  await expect.poll(() => state.mergePayload).not.toBeNull();
  expect(state.mergePayload.accepted_paths).toEqual(["README.md"]);
  await expect(page.getByText("合并冲突：临时分支已保留")).toBeVisible();
  await expect(page.locator("#wb-branch")).toContainText("code/");
  await expect(page.locator("#wb-push")).toBeEnabled();
  await expect(page.locator(".wb-change-row").filter({ hasText: "README.md" })).toBeVisible();
});

test("discard audit failure keeps a retry path after the branch is already deleted", async ({ page }) => {
  const state = fixtures();
  state.discardAuditFailuresRemaining = 1;
  await installApiFixtures(page, state);
  await openWorkbench(page);

  await page.locator("#wb-discard").click();
  await expect.poll(() => state.discardCalls).toBe(1);
  await expect(page.getByText("临时分支已删除，审计/状态清理待完成")).toBeVisible();
  await expect(page.locator("#wb-branch")).toContainText("code/");

  await page.locator("#wb-discard").click();
  await expect.poll(() => state.discardCalls).toBe(2);
  await expect(page.locator("#wb-branch")).toContainText("无活动临时分支");
  await expect(page.locator("#wb-version-list")).toContainText("操作记录：discard");
  await expect(page.locator("#wb-version-list")).toContainText("操作者 playwright-user");
});

test("failed discard keeps the active branch and permits another attempt", async ({ page }) => {
  const state = fixtures();
  state.discardFailure = true;
  await installApiFixtures(page, state);
  await openWorkbench(page);

  await page.locator("#wb-discard").click();
  await expect.poll(() => state.discardPayload).not.toBeNull();
  await expect(page.locator("#wb-branch")).toContainText("code/");
  await expect(page.locator("#wb-discard")).toBeEnabled();
  expect(state.active).toBe(true);
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
