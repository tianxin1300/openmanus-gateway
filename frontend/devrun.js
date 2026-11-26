/* devrun.js —— 开发台：「同时启动」+ 状态链（用 GitHub Actions 当运行器）
 * 输入框上面那一行多两个按钮：
 *   「同时启动」→ 触发 GitHub Actions 的 dev-run 工作流：前端 build 和 Worker 预检两个 job 并行跑，两个日志并排显示；
 *   「状态链」  → 已生成 → 已验证 → 已提交 → 部署中 → 线上健康 / 部署失败。走到哪亮到哪（绿），失败变红，点红的看报错。
 * 点「推」成功后会自动打开状态链。依赖后端 /api/dev/start | status | log | chain（只有主人账号能用）。
 * 说明：这里的 job 是 CI 里的检查 / 预检，不是常驻的开发服务器；真正的部署还是 push 到 main 之后由 Cloudflare 自动做。
 */
(function () {
  "use strict";
  if (window.__omDev) return;
  window.__omDev = true;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function gw() { try { return typeof GATEWAY !== "undefined" ? GATEWAY : ""; } catch (e) { return ""; } }
  function api(path, opt) {
    var f = (typeof authFetch === "function") ? authFetch : function (u, o) {
      var h = new Headers((o && o.headers) || {}), t = ls("openmanus_token");
      if (t) h.set("Authorization", "Bearer " + t);
      return fetch(u, Object.assign({}, o, { headers: h }));
    };
    return f(gw() + path, opt || {});
  }
  function parse(r) { return r.json().catch(function () { return { ok: false, msg: "服务器返回的不是 JSON（HTTP " + r.status + "）" }; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var toastTimer = 0;
  function toast(msg) {
    var t = document.getElementById("om-toast");
    if (!t) { t = el("div"); t.id = "om-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  var css = document.createElement("style");
  css.id = "om-dev-css";
  css.textContent = [
    ".om-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid #d9e7d7;border-radius:13px;background:#f1f7ee;color:#4d7d55;font:inherit;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}",
    "#om-dev-panel{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:min(900px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#19362a);border:1px solid var(--line,#dfe9df);border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -10px 34px rgba(16,41,31,.22);z-index:1001;font-size:13px;box-sizing:border-box}",
    "#om-dev-panel *{box-sizing:border-box}",
    "#om-dev-panel[hidden]{display:none}",
    ".omd-h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#dfe9df)}",
    ".omd-h strong{font-size:14px;white-space:nowrap}",
    ".omd-m{flex:1;min-width:0;color:var(--muted,#71867a);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".omd-x{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted,#71867a);font-size:20px;line-height:1;cursor:pointer}",
    ".omd-b{overflow:auto;padding:10px 14px 16px;flex:1}",
    ".omd-t{margin:10px 0 6px;font-weight:700;font-size:13px}",
    ".omd-chain{display:flex;align-items:center;flex-wrap:wrap;gap:6px}",
    ".omd-link{width:16px;height:2px;background:#d3ded3;border-radius:2px}.omd-link.omd-ok{background:#22c55e}",
    ".omd-node{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:17px;border:1px solid #d3ded3;background:#f4f7f3;color:#71867a;font:inherit;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap}",
    ".omd-node i{width:10px;height:10px;border-radius:50%;background:#aab7ad}",
    ".omd-node.omd-ok{background:#e3f3e5;border-color:#9fd0a6;color:#1f6b33}.omd-node.omd-ok i{background:#22c55e}",
    ".omd-node.omd-running{background:#e8f0fe;border-color:#a9c3f5;color:#1d4ed8}.omd-node.omd-running i{background:#2563eb;animation:omdp 1s infinite}",
    ".omd-node.omd-fail{background:#fdecec;border-color:#e8a5a5;color:#b42323}.omd-node.omd-fail i{background:#dc2626}",
    "@keyframes omdp{50%{opacity:.3}}",
    ".omd-info{margin-top:8px;font-size:12px;color:var(--muted,#71867a);word-break:break-all}.omd-info a{color:inherit;text-decoration:underline}",
    ".omd-detail{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:#f4f7f3;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto}",
    ".omd-detail[hidden]{display:none}.omd-detail.omd-d-fail{background:#fdecec;color:#8a1f1f}",
    ".omd-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
    ".omd-rm{flex:1;min-width:0;font-size:12px;color:var(--muted,#71867a)}.omd-rm a{color:inherit;text-decoration:underline}",
    ".omd-btn{height:36px;min-width:92px;padding:0 16px;border-radius:10px;border:1px solid var(--line,#dfe9df);background:#fff;color:#43506a;font-size:14px;font-weight:700;cursor:pointer}",
    ".omd-btn.omd-go{background:var(--accent,#287447);color:#fff;border-color:transparent}.omd-btn:disabled{opacity:.5;cursor:default}",
    ".omd-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}",
    "@media (max-width:560px){.omd-cols{grid-template-columns:1fr}}",
    ".omd-card{min-width:0;border:1px solid var(--line,#dfe9df);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}",
    ".omd-ct{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--canvas,#f4f8f2)}",
    ".omd-badge{padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;background:#e6ebe6;color:#71867a}",
    ".omd-badge.omd-run{background:#e8f0fe;color:#1d4ed8}.omd-badge.omd-ok{background:#e3f3e5;color:#1f6b33}.omd-badge.omd-fail{background:#fdecec;color:#b42323}",
    ".omd-steps{padding:6px 10px;font-size:12px;border-bottom:1px solid var(--line,#eef3ec)}",
    ".omd-step{display:flex;align-items:center;gap:6px;padding:1px 0}.omd-step i{flex:none;width:8px;height:8px;border-radius:50%;background:#aab7ad}",
    ".omd-step.omd-ok i{background:#22c55e}.omd-step.omd-run i{background:#2563eb}.omd-step.omd-fail{color:#b42323;font-weight:700}.omd-step.omd-fail i{background:#dc2626}",
    ".omd-log{padding:8px 10px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;height:220px;overflow:auto;background:#101c16;color:#d6e6da}",
    ".omd-errs{margin-bottom:6px;padding:6px 8px;border-radius:6px;background:#3a1717;color:#ffb4b4}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(css);

  var panel = null, chainBox = null, infoEl = null, detailEl = null, startBtn = null, runMsg = null, cols = {};
  var isOpen = false, chainTimer = 0, runTimer = 0, startedAt = 0, logged = {}, probeCache = { sha: "", at: 0, res: null }, selId = "";

  function card(title) {
    var box = el("div", "omd-card"), top = el("div", "omd-ct"), badge = el("span", "omd-badge", "等待");
    top.appendChild(el("strong", "", title)); top.appendChild(badge);
    var steps = el("div", "omd-steps"), log = el("div", "omd-log", "（还没有日志）");
    box.appendChild(top); box.appendChild(steps); box.appendChild(log);
    return { box: box, badge: badge, steps: steps, log: log };
  }
  function ensurePanel() {
    if (panel) return panel;
    panel = el("div"); panel.id = "om-dev-panel"; panel.hidden = true;
    panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "开发台运行与状态链");
    var head = el("div", "omd-h");
    head.appendChild(el("strong", "", "开发台 · 运行")); head.appendChild(el("span", "omd-m", "GitHub Actions 当运行器"));
    var x = el("button", "omd-x", "×"); x.type = "button"; x.setAttribute("aria-label", "关闭"); x.addEventListener("click", close); head.appendChild(x);
    panel.appendChild(head);
    var body = el("div", "omd-b");
    body.appendChild(el("div", "omd-t", "状态链"));
    chainBox = el("div", "omd-chain"); body.appendChild(chainBox);
    infoEl = el("div", "omd-info", "读取中…"); body.appendChild(infoEl);
    detailEl = el("pre", "omd-detail"); detailEl.hidden = true; body.appendChild(detailEl);
    body.appendChild(el("div", "omd-t", "同时启动（前端 build 和 Worker 预检，两个 job 并行）"));
    var row = el("div", "omd-row");
    startBtn = el("button", "omd-btn omd-go", "同时启动"); startBtn.type = "button"; startBtn.addEventListener("click", start);
    runMsg = el("span", "omd-rm", "点「同时启动」会在 GitHub 上跑一次，日志在下面并排显示");
    row.appendChild(startBtn); row.appendChild(runMsg); body.appendChild(row);
    var grid = el("div", "omd-cols");
    cols.fe = card("前端 build"); cols.wk = card("Worker 预检");
    grid.appendChild(cols.fe.box); grid.appendChild(cols.wk.box); body.appendChild(grid);
    panel.appendChild(body); document.body.appendChild(panel);
    return panel;
  }
  function open() { ensurePanel(); panel.hidden = false; isOpen = true; pollChain(); if (!startedAt) pollRun(); }
  function close() { isOpen = false; if (panel) panel.hidden = true; clearTimeout(chainTimer); clearTimeout(runTimer); }

  /* ---------- 状态链 ---------- */
  function fmtProbe(p) { return (p.ok ? "✓ " : "✗ ") + p.name + "  HTTP " + p.status + "  " + p.ms + "ms" + (p.err ? "  " + p.err : ""); }
  function probe() {
    var list = [{ name: "前端页面 " + location.origin, url: location.origin + "/?_=" + Date.now() }, { name: "Worker /api/models", url: gw() + "/api/models?_=" + Date.now() }];
    return Promise.all(list.map(function (u) {
      var t0 = Date.now();
      return fetch(u.url, { cache: "no-store" }).then(function (r) { return r.text().then(function (b) { return { name: u.name, ok: r.ok && b.length > 50, status: r.status, ms: Date.now() - t0 }; }); })
        .catch(function (e) { return { name: u.name, ok: false, status: 0, ms: Date.now() - t0, err: String(e && e.message || e) }; });
    }));
  }
  function buildStages(ch, probes) {
    var s = ch.stages.slice(), dep = ch.deploy, last;
    if (dep && dep.state === "fail") last = { id: "live", label: "部署失败", state: "fail", detail: dep.detail + (dep.url ? "\n" + dep.url : "") };
    else if (s[3] && s[3].state === "ok" && probes) {
      var bad = probes.filter(function (p) { return !p.ok; });
      last = bad.length ? { id: "live", label: "线上不健康", state: "fail", detail: probes.map(fmtProbe).join("\n") } : { id: "live", label: "线上健康", state: "ok", detail: probes.map(fmtProbe).join("\n") };
    } else if (s[3] && s[3].state === "ok") last = { id: "live", label: "线上健康", state: "running", detail: "正在检测线上是否可访问…" };
    else last = { id: "live", label: "线上健康", state: "idle", detail: "" };
    s.push(last); return s;
  }
  function showDetail(st) {
    if (!st || (!st.detail && st.state !== "fail")) { detailEl.hidden = true; return; }
    detailEl.hidden = false; detailEl.className = "omd-detail omd-d-" + st.state;
    detailEl.textContent = st.label + (st.state === "fail" ? "（失败）" : "") + "：\n" + (st.detail || "没有更多信息");
  }
  function renderChain(ch, probes) {
    var stages = buildStages(ch, probes); clear(chainBox);
    stages.forEach(function (st, i) {
      if (i) chainBox.appendChild(el("span", "omd-link" + (stages[i - 1].state === "ok" ? " omd-ok" : "")));
      var n = el("button", "omd-node omd-" + st.state); n.type = "button"; n.appendChild(document.createElement("i")); n.appendChild(el("span", "", st.label));
      n.addEventListener("click", function () { selId = st.id; showDetail(st); });
      chainBox.appendChild(n);
    });
    clear(infoEl);
    if (ch.sha) { infoEl.appendChild(document.createTextNode("最近一次推送：")); var a = el("a", "", ch.sha); a.href = ch.commitUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; infoEl.appendChild(a); if (ch.deploy && ch.deploy.url) { infoEl.appendChild(document.createTextNode("　部署详情：")); var b = el("a", "", "打开"); b.href = ch.deploy.url; b.target = "_blank"; b.rel = "noopener noreferrer"; infoEl.appendChild(b); } }
    else infoEl.textContent = stages.every(function (s) { return s.state === "idle"; }) ? "还没有推送记录。在代码模式里改完点「推」后，这里会一格一格亮起来。" : "";
    var pick = stages.filter(function (s) { return s.id === selId; })[0] || stages.filter(function (s) { return s.state === "fail"; })[0];
    showDetail(pick);
  }
  function pollChain() {
    clearTimeout(chainTimer);
    if (!isOpen) return;
    api("/api/dev/chain").then(parse).then(function (j) {
      if (!j || j.ok === false || !j.stages) { infoEl.textContent = "状态链读取失败：" + ((j && (j.msg || j.reply)) || "未知"); return; }
      var reached = j.stages[3] && j.stages[3].state === "ok" && !(j.deploy && j.deploy.state === "fail");
      if (!reached) { renderChain(j, null); return; }
      var key = j.sha || "none";
      if (probeCache.sha === key && probeCache.res && Date.now() - probeCache.at < 60000) { renderChain(j, probeCache.res); return; }
      renderChain(j, null);
      probe().then(function (res) { probeCache = { sha: key, at: Date.now(), res: res }; if (isOpen) renderChain(j, res); });
    }).catch(function (e) { infoEl.textContent = "状态链读取失败：" + (e && e.message || e); })
      .then(function () { if (isOpen) chainTimer = setTimeout(pollChain, 5000); });
  }

  /* ---------- 同时启动 ---------- */
  function jobKey(job, i) { var n = String(job.name || "").toLowerCase(); if (/前端|frontend/.test(n)) return "fe"; if (/worker/.test(n)) return "wk"; return i === 0 ? "fe" : "wk"; }
  function badgeOf(job) {
    if (!job) return ["等待", "idle"];
    if (job.status === "queued") return ["排队中", "run"];
    if (job.status === "in_progress") return ["运行中", "run"];
    if (job.conclusion === "success") return ["成功", "ok"];
    if (job.conclusion === "cancelled" || job.conclusion === "skipped") return ["已取消", "idle"];
    return ["失败", "fail"];
  }
  function stepCls(s) { return s.status !== "completed" ? (s.status === "in_progress" ? "run" : "idle") : s.conclusion === "success" || s.conclusion === "skipped" ? "ok" : "fail"; }
  function resetCards() { ["fe", "wk"].forEach(function (k) { var c = cols[k]; c.badge.className = "omd-badge"; c.badge.textContent = "等待"; clear(c.steps); c.log.textContent = "（还没有日志）"; }); }
  function loadLog(job, key) {
    var c = cols[key], done = job.status === "completed";
    if (done && logged[job.id]) return;
    if (done) logged[job.id] = true;
    api("/api/dev/log?job=" + job.id).then(parse).then(function (j) {
      if (!j.ok) { if (done) c.log.textContent = j.msg || "读日志失败"; return; }
      clear(c.log);
      if (j.errors && j.errors.length && job.conclusion && job.conclusion !== "success") {
        var eb = el("div", "omd-errs"); eb.appendChild(el("div", "", "报错行："));
        j.errors.forEach(function (l) { eb.appendChild(el("div", "", l)); }); c.log.appendChild(eb);
      }
      c.log.appendChild(document.createTextNode(j.log || ""));
      if (!(j.errors && j.errors.length)) c.log.scrollTop = c.log.scrollHeight;
    }).catch(function () {});
  }
  var polls = 0;
  function renderRun(j) {
    polls++;
    (j.jobs || []).forEach(function (job, i) {
      var key = jobKey(job, i), c = cols[key]; if (!c) return;
      var b = badgeOf(job); c.badge.className = "omd-badge omd-" + b[1]; c.badge.textContent = b[0];
      clear(c.steps);
      (job.steps || []).forEach(function (s) { var row = el("div", "omd-step omd-" + stepCls(s)); row.appendChild(document.createElement("i")); row.appendChild(el("span", "", s.name)); c.steps.appendChild(row); });
      if (job.status === "completed" || (job.status === "in_progress" && polls % 3 === 0)) loadLog(job, key);
    });
  }
  function pollRun() {
    clearTimeout(runTimer);
    api("/api/dev/status").then(parse).then(function (j) {
      if (!j || !j.ok) { runMsg.textContent = (j && (j.msg || j.reply)) || "读取失败"; startBtn.disabled = false; return "stop"; }
      var run = j.run;
      if (!run) { runMsg.textContent = "还没有运行记录，点「同时启动」"; startBtn.disabled = false; return "stop"; }
      if (startedAt && Date.parse(run.at) < startedAt - 60000) { runMsg.textContent = "已触发，等 GitHub 排上队…"; return "wait"; }
      renderRun(j);
      clear(runMsg);
      var a = el("a", "", "在 GitHub 上打开"); a.href = run.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      if (run.status === "completed") {
        runMsg.appendChild(document.createTextNode(run.conclusion === "success" ? "两个 job 都通过　" : "有 job 失败（红色的那个，下面能看到报错行）　")); runMsg.appendChild(a);
        startBtn.disabled = false; return "stop";
      }
      runMsg.appendChild(document.createTextNode("运行中（" + (run.status === "queued" ? "排队" : "两个 job 并行") + "）　")); runMsg.appendChild(a);
      return "wait";
    }).then(function (st) {
      if (st === "wait" && isOpen && (!startedAt || Date.now() - startedAt < 15 * 60000)) runTimer = setTimeout(pollRun, 3000);
      else if (st === "wait") startBtn.disabled = false;
    }).catch(function (e) { runMsg.textContent = "读取失败：" + (e && e.message || e); startBtn.disabled = false; });
  }
  function start() {
    startBtn.disabled = true; runMsg.textContent = "正在触发…"; startedAt = Date.now(); logged = {}; polls = 0; resetCards();
    api("/api/dev/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(parse).then(function (j) {
      if (!j || !j.ok) { runMsg.textContent = "触发失败：" + ((j && (j.msg || j.reply)) || "未知原因"); startBtn.disabled = false; startedAt = 0; return; }
      runMsg.textContent = "已触发，等 GitHub 排上队…"; setTimeout(pollRun, 2500);
    }).catch(function (e) { runMsg.textContent = "触发失败：" + (e && e.message || e); startBtn.disabled = false; startedAt = 0; });
  }

  /* ---------- 按钮：放在输入框上面那一行 ---------- */
  function mount(tries) {
    if (document.getElementById("om-dev-run-btn")) return;
    var bar = document.getElementById("om-code-bar");
    if (!bar && tries < 20) { setTimeout(function () { mount(tries + 1); }, 250); return; }
    var b1 = el("button", "om-chip", "同时启动"); b1.id = "om-dev-run-btn"; b1.type = "button"; b1.title = "触发 GitHub Actions：前端 build 和 Worker 预检并行跑，日志并排显示";
    var b2 = el("button", "om-chip", "状态链"); b2.id = "om-dev-chain-btn"; b2.type = "button"; b2.title = "已生成 → 已验证 → 已提交 → 部署中 → 线上健康 / 部署失败";
    b1.addEventListener("click", function () { open(); if (!startBtn.disabled) start(); });
    b2.addEventListener("click", open);
    if (bar) { bar.appendChild(b1); bar.appendChild(b2); }
    else { b1.style.cssText = "position:fixed;left:12px;bottom:166px;z-index:999"; b2.style.cssText = "position:fixed;left:110px;bottom:166px;z-index:999"; document.body.appendChild(b1); document.body.appendChild(b2); }
  }

  /* ---------- 点「推」成功后，自动打开状态链 ---------- */
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var p = realFetch(input, init);
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (/\/api\/code\/confirm(?:[?#]|$)/.test(url) && init && typeof init.body === "string" && /"yes"\s*:\s*true/.test(init.body)) {
        p.then(function (r) { r.clone().json().then(function (j) { if (j && j.pushed) setTimeout(open, 600); }, function () {}); }, function () {});
      }
    } catch (e) { /* 不影响正常请求 */ }
    return p;
  };

  function init() { mount(0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.omDev = { open: open, close: close, start: start };
})();
