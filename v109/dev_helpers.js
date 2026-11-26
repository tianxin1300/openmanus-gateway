// ===== v109：开发台——「同时启动」（GitHub Actions 里前端 build 和 Worker 预检两个 job 并行）+ 状态链 =====
// 全走 GH_PAT 调 GitHub REST，只有主人账号能用。fine-grained PAT 需要：Actions（读写）、Checks（读）、Commit statuses（读）、Deployments（读），再加原来的 Contents（读写）。
const DEV_WORKFLOW = "dev-run.yml";
async function devAuth(request, env, url) {   // 返回 {user, repo, branch} 或 {err, status}
  const user = await userFromReq(request, env, url, "");
  if (!user) return { err: "未登录，token失效", status: 401 };
  const proj = CODE_PROJECTS.find((p) => p.names.includes("聚合体")), bad = codePushGuard(env, user, proj.repo, DEV_WORKFLOW);
  if (bad) return { err: bad, status: 403 };
  return { user, repo: proj.repo, branch: String(env.CODE_PUSH_BRANCH || "main") };
}
async function devGh(env, path, opt) {   // 调 GitHub REST，返回 {ok, status, json, text}
  if (!env.GH_PAT) return { ok: false, status: 0, msg: "GH_PAT 没有配置" };
  try {
    const o = opt || {}, r = await fetch("https://api.github.com" + path, { method: o.method || "GET", body: o.body, headers: { ...codeGhHeaders(env), ...(o.headers || {}) }, signal: AbortSignal.timeout(15000) });
    const text = await r.text().catch(() => "");
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) { return { ok: false, status: 0, msg: String(e && e.message || e).slice(0, 120) }; }
}
const devWhy = (r, what) => r.status === 401 || r.status === 403 ? "GH_PAT 没有" + what + "权限" : r.status === 404 ? "GitHub 返回 404（仓库名不对 / PAT 看不到这个仓库 / 工作流还没建）" : "HTTP " + r.status + (r.json && r.json.message ? "：" + r.json.message : r.msg ? "：" + r.msg : "");
async function devStart(env, au) {   // 触发 dev-run.yml（里面两个 job 并行）
  const d = await devGh(env, "/repos/" + au.repo + "/actions/workflows/" + DEV_WORKFLOW + "/dispatches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: au.branch }) });
  if (d.status === 204) return { ok: true, at: Date.now() };
  return { ok: false, msg: d.status === 404 ? "仓库里还没有 .github/workflows/" + DEV_WORKFLOW + "（先在 GitHub 网页上新建它）" : "触发失败：" + devWhy(d, " Actions 写") };
}
async function devStatus(env, au) {   // 最近一次 dev-run 的 run + 两个 job + 每个 step 的状态
  const rr = await devGh(env, "/repos/" + au.repo + "/actions/workflows/" + DEV_WORKFLOW + "/runs?event=workflow_dispatch&per_page=1");
  if (!rr.ok) return { ok: false, msg: "读取失败：" + devWhy(rr, " Actions 读") };
  const run = rr.json && rr.json.workflow_runs && rr.json.workflow_runs[0];
  if (!run) return { ok: true, run: null, jobs: [] };
  const jr = await devGh(env, "/repos/" + au.repo + "/actions/runs/" + run.id + "/jobs?per_page=10");
  const jobs = ((jr.json && jr.json.jobs) || []).map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, started: j.started_at, done: j.completed_at, url: j.html_url, steps: (j.steps || []).map((s) => ({ n: s.number, name: s.name, status: s.status, conclusion: s.conclusion })) }));
  return { ok: true, run: { id: run.id, status: run.status, conclusion: run.conclusion, url: run.html_url, at: run.created_at, sha: String(run.head_sha || "").slice(0, 7) }, jobs };
}
async function devLog(env, au, jobId) {   // 一个 job 的日志（尾部 400 行）+ 报错行
  if (!/^\d{1,15}$/.test(String(jobId))) return { ok: false, msg: "job 编号不对" };
  if (!env.GH_PAT) return { ok: false, msg: "GH_PAT 没有配置" };
  try {
    const r = await fetch("https://api.github.com/repos/" + au.repo + "/actions/jobs/" + jobId + "/logs", { headers: codeGhHeaders(env), redirect: "manual", signal: AbortSignal.timeout(15000) });
    let text = "";
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const l = await fetch(r.headers.get("location"), { signal: AbortSignal.timeout(20000) });
      if (!l.ok) return { ok: false, msg: "日志下载失败 HTTP " + l.status };
      text = await l.text();
    } else if (r.ok) text = await r.text();
    else return { ok: false, msg: r.status === 404 ? "这个 job 的日志还没有（跑完才有）" : "读日志失败：" + devWhy({ status: r.status }, " Actions 读") };
    const lines = text.replace(/\r/g, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, "").split("\n");
    const errors = lines.filter((l) => /##\[error\]|(^|\s)(error|Error|ERROR)\b|\bFAIL(ED)?\b|Traceback/.test(l)).map((l) => l.replace(/##\[error\]/, "").trim()).filter(Boolean).slice(0, 30);
    const tail = lines.length > 400 ? ["…（前面 " + (lines.length - 400) + " 行省略）"].concat(lines.slice(-400)) : lines;
    return { ok: true, log: tail.join("\n").slice(-30000), errors };
  } catch (e) { return { ok: false, msg: String(e && e.message || e).slice(0, 120) }; }
}
async function codeChainMark(env, user, patch, reset) {   // 状态链的记录：已生成 / 已验证 / 已提交（codeConfirm 里写）
  if (!env.KV) return;
  try {
    const key = "code:chain:" + user, old = reset ? {} : (await env.KV.get(key, "json")) || {};
    await env.KV.put(key, JSON.stringify({ ...old, ...patch }), { expirationTtl: 86400 });
  } catch (e) {}
}
async function devDeploy(env, repo, sha) {   // 读这个提交的 Cloudflare 部署状态：check-runs → commit status → deployments
  const isCf = (s) => /cloudflare|pages|workers/i.test(String(s || ""));
  const cr = await devGh(env, "/repos/" + repo + "/commits/" + sha + "/check-runs?per_page=50");
  const runs = ((cr.json && cr.json.check_runs) || []).filter((c) => isCf((c.app && (c.app.slug || c.app.name)) + " " + c.name));
  if (runs.length) {
    const bad = runs.find((c) => ["failure", "cancelled", "timed_out", "action_required"].includes(c.conclusion));
    if (bad) return { state: "fail", detail: (bad.name + "：" + ((bad.output && (bad.output.title || bad.output.summary)) || bad.conclusion)).slice(0, 800), url: bad.html_url || "" };
    if (runs.some((c) => c.status !== "completed")) return { state: "running", detail: runs.map((c) => c.name + "：" + c.status).join("；"), url: runs[0].html_url || "" };
    return { state: "ok", detail: runs.map((c) => c.name + "：" + c.conclusion).join("；"), url: runs[0].html_url || "" };
  }
  const cs = await devGh(env, "/repos/" + repo + "/commits/" + sha + "/status");
  const ss = ((cs.json && cs.json.statuses) || []).filter((s) => isCf(s.context));
  if (ss.length) {
    const bad = ss.find((s) => s.state === "failure" || s.state === "error");
    if (bad) return { state: "fail", detail: (bad.context + "：" + (bad.description || bad.state)).slice(0, 800), url: bad.target_url || "" };
    if (ss.some((s) => s.state === "pending")) return { state: "running", detail: ss.map((s) => s.context + "：" + s.state).join("；"), url: ss[0].target_url || "" };
    return { state: "ok", detail: ss.map((s) => s.context + "：" + s.state).join("；"), url: ss[0].target_url || "" };
  }
  const dp = await devGh(env, "/repos/" + repo + "/deployments?sha=" + sha + "&per_page=5");
  const dep = Array.isArray(dp.json) ? dp.json[0] : null;
  if (dep) {
    const ds = await devGh(env, "/repos/" + repo + "/deployments/" + dep.id + "/statuses?per_page=1"), s = Array.isArray(ds.json) ? ds.json[0] : null, state = s ? s.state : "pending", name = dep.environment || "deployment";
    if (state === "failure" || state === "error") return { state: "fail", detail: (name + "：" + ((s && s.description) || state)).slice(0, 800), url: (s && (s.log_url || s.target_url)) || "" };
    if (state === "success") return { state: "ok", detail: name + "：success", url: (s && (s.environment_url || s.target_url)) || "" };
    return { state: "running", detail: name + "：" + state, url: (s && s.target_url) || "" };
  }
  const denied = [cr, cs, dp].some((x) => x.status === 403);
  return { state: "unknown", detail: denied ? "GH_PAT 没有读取部署状态的权限（要加 Checks / Commit statuses / Deployments 的读权限）" : "GitHub 上没有查到 Cloudflare 的部署回报（Cloudflare 可能没有把状态回报给 GitHub）", url: "" };
}
async function devChain(env, au) {   // 已生成 → 已验证 → 已提交 → 部署中（线上健康 / 部署失败 由前端探活后补第 5 格）
  const rec = (env.KV && (await env.KV.get("code:chain:" + au.user, "json"))) || {}, pend = await codePendGet(env, au.user);
  const st = (id, label, state, detail) => ({ id, label, state, detail: detail || "" });
  const gen = pend ? st("gen", "已生成", "ok", (pend.summary || "") + "（" + pend.edits.length + " 处改动，等你点推 / 不推）") : rec.gen ? st("gen", "已生成", "ok", (rec.gen.summary || "") + "（" + (rec.gen.n || 0) + " 处改动）") : st("gen", "已生成", "idle");
  const ver = rec.ver ? st("ver", "已验证", rec.ver.ok ? "ok" : "fail", rec.ver.ok ? "改动和最新文件逐块对上了（文件没被别人改过）" : (rec.ver.msg || "校验没通过")) : st("ver", "已验证", "idle");
  const com = rec.com ? st("com", "已提交", rec.com.ok ? "ok" : "fail", rec.com.msg || "") : rec.ver && rec.ver.ok ? st("com", "已提交", "running", "正在推送…") : st("com", "已提交", "idle");
  let dep = st("dep", "部署中", "idle"), deploy = null, sha = "", since = 0;
  if (rec.com && rec.com.ok) {
    since = Date.now() - Number(rec.com.at || 0);
    const cm = await devGh(env, "/repos/" + rec.com.repo + "/commits?sha=" + encodeURIComponent(rec.com.branch) + "&per_page=5");
    const hit = Array.isArray(cm.json) ? cm.json.find((c) => Date.parse((c.commit && c.commit.committer && c.commit.committer.date) || "") >= Number(rec.com.at) - 180000 && /^AI:/.test((c.commit && c.commit.message) || "")) : null;
    sha = hit ? hit.sha : "";
    deploy = sha ? await devDeploy(env, rec.com.repo, sha) : { state: "unknown", detail: "没在 " + rec.com.branch + " 上找到刚推的提交", url: "" };
    if (deploy.state === "unknown" && since < 90000) dep = st("dep", "部署中", "running", "等 Cloudflare 回报部署状态…（" + deploy.detail + "）");
    else if (deploy.state === "running") dep = st("dep", "部署中", "running", deploy.detail);
    else dep = st("dep", "部署中", "ok", deploy.detail);
  }
  return { ok: true, stages: [gen, ver, com, dep], deploy, sha: sha.slice(0, 7), commitUrl: sha ? "https://github.com/" + rec.com.repo + "/commit/" + sha : "", sinceMs: since };
}
