import assert from "node:assert/strict";

const baseUrl = process.env.WORKER_URL;
const token = process.env.WORKER_TEST_TOKEN;
const e2eSecret = process.env.WORKBENCH_E2E_SECRET;
const githubToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || "tianxin1300/openmanus-gateway";
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const owner = repo.split("/")[0];
const actor = "workbench-e2e";
const baseBranch = `e2e-workbench-runtime-${runId}`;
const testPath = `e2e-workbench-runtime-${runId}.txt`;
let tempBranch = "";

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
required(baseUrl, "WORKER_URL");
required(token, "WORKER_TEST_TOKEN");
required(e2eSecret, "WORKBENCH_E2E_SECRET");
required(githubToken, "GITHUB_TOKEN");

async function gh(path, method = "GET", body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(`GitHub ${method} ${path}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function worker(path, { method = "GET", body, auth = true, e2e = false, allowStatuses = [] } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...(e2e ? { "x-workbench-e2e": e2eSecret } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok && !allowStatuses.includes(response.status)) throw new Error(`Worker ${method} ${path}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 700)}`);
  return data;
}

async function deleteRef(branch) {
  if (!branch) return;
  try {
    await gh(`git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, "DELETE");
  } catch (error) {
    if (!(error.status === 404 || (error.status === 422 && /Reference does not exist/i.test(error.message)))) throw error;
  }
}

const mainBefore = (await gh("git/ref/heads/main")).object.sha;
try {
  // Exercise a real SQLite-backed Durable Object across separate Worker requests.
  const lockId = `e2e:${repo.toLowerCase()}`;
  const lockA = { lock_id: lockId, token: `a-${runId}`, operation: "runtime-e2e" };
  const acquired = await worker("/__e2e/do/branch-lock", { method: "POST", body: lockA, auth: false, e2e: true });
  assert.equal(acquired.ok, true, "first DO lock request must acquire");
  const competing = await worker("/__e2e/do/branch-lock", {
    method: "POST",
    body: { ...lockA, token: `b-${runId}` },
    auth: false,
    e2e: true,
    allowStatuses: [409]
  });
  assert.equal(competing.ok, false, "second HTTP request must observe persisted DO lock");
  assert.equal(competing.busy, true, "second HTTP request must be rejected as busy");
  const renewed = await worker("/__e2e/do/branch-renew", { method: "POST", body: lockA, auth: false, e2e: true });
  assert.equal(renewed.ok, true, "DO lock renewal must persist");
  const released = await worker("/__e2e/do/branch-unlock", { method: "POST", body: lockA, auth: false, e2e: true });
  assert.equal(released.ok, true, "DO lock release must persist");

  // Create a disposable target branch; the real Worker merge route must never target main.
  const mainRef = await gh("git/ref/heads/main");
  await gh("git/refs", "POST", { ref: `refs/heads/${baseBranch}`, sha: mainRef.object.sha });
  const created = await worker("/api/code/branch/create", {
    method: "POST",
    body: { repo, project: `runtime-e2e-${runId}`, base: baseBranch }
  });
  tempBranch = created.branch || "";
  assert.equal(created.ok, true, `real branch/create route failed: ${created.msg || ""}`);
  assert.ok(tempBranch.startsWith("code/"), "Worker must create a guarded code/ branch");

  // A second create call must return the same persisted branch, not create another one.
  const duplicate = await worker("/api/code/branch/create", {
    method: "POST",
    body: { repo, project: `runtime-e2e-${runId}`, base: baseBranch }
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.branch, tempBranch, "idempotent create must reuse the persisted branch");

  // Write one test file to the disposable temp branch using real GitHub Git Data APIs.
  const baseCommit = await gh(`git/commits/${mainRef.object.sha}`);
  const blob = await gh("git/blobs", "POST", {
    content: `Cloudflare Worker runtime E2E ${runId}\\n`,
    encoding: "utf-8"
  });
  const tree = await gh("git/trees", "POST", {
    base_tree: baseCommit.tree.sha,
    tree: [{ path: testPath, mode: "100644", type: "blob", sha: blob.sha }]
  });
  const editCommit = await gh("git/commits", "POST", {
    message: `test: Cloudflare Worker runtime E2E ${runId}`,
    tree: tree.sha,
    parents: [mainRef.object.sha]
  });
  await gh(`git/refs/heads/${tempBranch.split("/").map(encodeURIComponent).join("/")}`, "PATCH", {
    sha: editCommit.sha,
    force: false
  });

  // Exercise the real HTTP merge route, DO lock, GitHub merge transaction, and KV history.
  const merged = await worker("/api/code/branch/merge", {
    method: "POST",
    body: { repo, branch: tempBranch, summary: `Cloudflare Worker runtime E2E ${runId}` }
  });
  assert.equal(merged.ok, true, `real branch/merge route failed: ${merged.msg || ""}`);
  assert.equal(merged.merged, true);
  assert.equal(merged.branch_deleted, true);
  assert.ok(merged.commit_sha, "merge route must return the real resulting commit SHA");

  const current = await worker(`/api/code/branch/current?repo=${encodeURIComponent(repo)}`);
  assert.equal(current.active, false, "KV branch record must be removed after successful merge");
  const targetRef = await gh(`git/ref/heads/${baseBranch}`);
  assert.equal(targetRef.object.sha, merged.commit_sha, "disposable target ref must point at Worker merge commit");
  const mergeCommit = await gh(`git/commits/${merged.commit_sha}`);
  assert.equal(mergeCommit.parents.length, 2, "real Worker merge must create a two-parent commit");
  const content = await gh(`contents/${encodeURIComponent(testPath)}?ref=${encodeURIComponent(baseBranch)}`);
  assert.equal(Buffer.from(content.content, "base64").toString("utf8"), `Cloudflare Worker runtime E2E ${runId}\\n`);

  const history = await worker("/__e2e/kv/history", { auth: false, e2e: true });
  assert.equal(history.ok, true);
  assert.ok(history.rows.some(row => row.commit_sha === merged.commit_sha && row.actor === actor),
    "real KV history must persist the resulting commit and authenticated actor");

  const missingTemp = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${tempBranch.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" }
  });
  assert.equal(missingTemp.status, 404, "merged temp branch must be deleted in GitHub");

  console.log(`PASS: real Worker HTTP routes, SQLite Durable Object lock contention/renew/release, KV branch/history persistence, and isolated GitHub merge verified. commit=${merged.commit_sha}`);
} finally {
  // Attempt every cleanup independently so one failed deletion cannot skip the others.
  const cleanupErrors = [];
  if (tempBranch) {
    try {
      await worker("/api/code/branch/discard", { method: "POST", body: { repo, branch: tempBranch } });
    } catch (error) {
      console.error("Worker discard cleanup warning:", error.message);
    }
    try { await deleteRef(tempBranch); } catch (error) { cleanupErrors.push(`temp branch ${tempBranch}: ${error.message}`); }
  }
  try { await deleteRef(baseBranch); } catch (error) { cleanupErrors.push(`base branch ${baseBranch}: ${error.message}`); }
  try {
    const mainAfter = (await gh("git/ref/heads/main")).object.sha;
    assert.equal(mainAfter, mainBefore, "main must remain byte-for-byte at the same commit SHA");
    console.log(`PASS: main unchanged at ${mainAfter}; disposable target and temp refs cleaned.`);
  } catch (error) {
    cleanupErrors.push(`main integrity check: ${error.message}`);
  }
  if (cleanupErrors.length) throw new Error("Runtime E2E cleanup/integrity failures: " + cleanupErrors.join(" | "));
}
