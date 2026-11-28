/* studio.js —— 代码模式开关 + 改动预览面板（推 / 不推）
 *
 * 用法：在 index.html 里 </body> 前面加一行（只需加这一行，其余都在这个文件里）：
 *     <script src="studio.js"></script>
 *
 * 做四件事：
 *  1. 输入框上面加一个「代码模式」小药丸开关（颜色和旁边的「定位」药丸一致，手机上也在）。打开后，发给后端的每条聊天请求都带
 *     code_mode:true 和 code_project（聚合体 / 就医伴侣）。后端看到 code_mode 就一定进代码模式，不再猜你说了什么。
 *  2. 后端改完、生成了待推送的修改，就弹出「改动预览」面板：每处改动按 文件 + 行号 + 删除/新增 显示。
 *  3. 面板底下两个按钮：「推」→ 推到 GitHub；「不推」→ 丢弃。点一下就行，不用再打字回「推」。
 *  4. v108 防死循环：面板右上角「强制清空」一键清掉服务器里暂存的改动；发新消息时上一个没处理的预览自动收掉；
 *     10 分钟没点「推 / 不推」自动过期收掉。
 *
 * 后端接口（都要登录，沿用页面里的 authFetch / 登录 token）：
 *     GET  /api/code/pending          读取待推送的修改（带 left = 还剩多少毫秒过期）
 *     POST /api/code/confirm {yes}    yes:true = 推，yes:false = 不推
 *     POST /api/code/clear            强制清空（旧后端没有这个接口时，退回「不推」，效果一样）
 */
(function () {
  "use strict";
  if (window.__omStudio) return;
  window.__omStudio = true;

  var KEY_ON = "om_code_mode", KEY_PROJ = "om_code_project", PROJECTS = [];
  var state = { on: false, project: window.OM_CODE_PROJECT || "聚合体" };
  var panelState = "";   // "" | "pending"（等你点推/不推）| "result"（已出结果，等你关掉）

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  state.on = ls(KEY_ON) === "1";
  var saved = ls(KEY_PROJ); if (saved) state.project = saved;

  function gw() { try { return typeof GATEWAY !== "undefined" ? GATEWAY : ""; } catch (e) { return ""; } }
  function loggedIn() { try { return typeof authToken === "undefined" ? true : !!authToken; } catch (e) { return true; } }
  // 优先用页面自己的 authFetch（带登录 token，过期会自动弹登录框）；没有就自己带 token
  function api(path, opt) {
    var f = (typeof authFetch === "function") ? authFetch : function (u, o) {
      var h = new Headers((o && o.headers) || {}), t = ls("openmanus_token");
      if (t) h.set("Authorization", "Bearer " + t);
      return fetch(u, Object.assign({}, o, { headers: h }));
    };
    return f(gw() + path, opt || {});
  }
  function loadProjects() {
    if (!loggedIn()) return;
    return api("/api/code/projects", { cache: "no-store" }).then(function (response) {
      return response.json().catch(function () { return { ok: false, msg: "项目列表响应不是 JSON" }; });
    }).then(function (data) {
      if (!data || data.ok !== true || !Array.isArray(data.projects)) throw new Error((data && data.msg) || "读取 CODE_REPOS 授权仓库失败");
      PROJECTS = data.projects.filter(function (project) { return project && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(project.repo || "")); });
      if (sel) {
        sel.replaceChildren();
        PROJECTS.forEach(function (project) {
          var option = el("option", "", String(project.label || project.repo) + " · " + project.repo);
          option.value = project.repo; sel.appendChild(option);
        });
        var selected = PROJECTS.find(function (project) { return project.repo === state.project || project.label === state.project; }) || PROJECTS[0];
        state.project = selected ? selected.repo : "";
        sel.value = state.project;
        sel.disabled = !selected;
        if (selected) ls(KEY_PROJ, state.project);
      }
      if (!PROJECTS.length) {
        state.on = false; ls(KEY_ON, "0");
        if (box) box.disabled = true;
        if (hintEl) hintEl.textContent = "未配置 CODE_REPOS 授权仓库";
        syncToggle();
      } else {
        if (box) box.disabled = false;
        if (hintEl) hintEl.textContent = "仅显示 CODE_REPOS 授权仓库";
        syncToggle();
      }
    }).catch(function (error) {
      if (sel) sel.disabled = true;
      if (box) box.disabled = true;
      if (hintEl) hintEl.textContent = "授权项目列表读取失败：" + (error && error.message || error);
      toast("代码项目列表读取失败，已禁用代码模式");
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // 一律用 textContent：后端返回的代码里就算有 <script>，也只会当文字显示
    return n;
  }

  /* ---------- 样式（用页面自己的颜色变量，没有就用默认色） ---------- */
  var css = document.createElement("style");
  css.id = "om-studio-css";
  css.textContent = [
    "#om-code-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 8px;padding:0 2px}",
    ".om-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid #d9e7d7;border-radius:13px;background:#f1f7ee;color:#4d7d55;font:inherit;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}",
    ".om-chip i{width:8px;height:8px;border-radius:50%;background:#aab7ad}",
    ".om-chip.om-on{background:#e3f3e5;border-color:#9fd0a6;color:#1f6b33}",
    ".om-chip.om-on i{background:#22c55e}",
    ".om-chip.om-float{position:fixed;left:12px;bottom:92px;z-index:999;box-shadow:0 2px 10px rgba(16,41,31,.12)}",
    "#om-code-project{height:30px;border:1px solid #d9e7d7;border-radius:13px;background:#fff;color:#1f6b33;font-size:12px;font-weight:650;padding:0 8px;max-width:112px;flex:0 0 auto}",
    "#om-code-project[hidden],.om-hint[hidden]{display:none}",
    ".om-hint{font-size:11px;color:var(--muted,#71867a);min-width:0}",
    "#om-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);max-width:min(92vw,520px);padding:9px 14px;border-radius:10px;background:rgba(16,41,31,.92);color:#fff;font-size:13px;z-index:1100;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.25)}",
    "#om-code-panel{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:min(760px,100%);max-height:72vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#19362a);border:1px solid var(--line,#dfe9df);border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -10px 34px rgba(16,41,31,.22);z-index:1000;font-size:13px;box-sizing:border-box}",
    "#om-code-panel *{box-sizing:border-box}",
    "#om-code-panel[hidden]{display:none}",
    ".om-ph{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#dfe9df)}",
    ".om-ph strong{font-size:14px;white-space:nowrap}",
    ".om-meta{flex:1;min-width:0;color:var(--muted,#71867a);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".om-fc{flex:none;height:28px;padding:0 10px;border:1px solid #e3b4b4;border-radius:8px;background:#fff;color:#a12b2b;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}",
    ".om-fc:disabled{opacity:.5;cursor:default}",
    ".om-x{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted,#71867a);font-size:20px;line-height:1;cursor:pointer}",
    ".om-x:hover{background:#eef3ec}",
    "#om-code-reopen{position:fixed;right:14px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:999;display:none;align-items:center;gap:7px;height:40px;padding:0 15px;border:1px solid #a9d5b0;border-radius:999px;background:#e8f5e8;color:#205d32;font-size:13px;font-weight:750;box-shadow:0 5px 18px rgba(16,41,31,.2);cursor:pointer}",
    "#om-code-reopen.on{display:inline-flex}",
    ".om-refresh{flex:none;height:28px;padding:0 9px;border:1px solid var(--line,#dfe9df);border-radius:8px;background:#fff;color:var(--muted,#71867a);font-size:12px;cursor:pointer}",
    ".om-refresh:disabled{opacity:.5}",
    ".om-pull-hint{display:none;text-align:center;padding:5px;color:var(--muted,#71867a);font-size:11px}",
    ".om-pb{overflow:auto;padding:10px 14px;flex:1;min-height:56px}",
    ".om-edit{border:1px solid var(--line,#dfe9df);border-radius:10px;margin-bottom:10px;overflow:hidden}",
    ".om-file{padding:6px 10px;background:var(--canvas,#f4f8f2);font-size:12px;font-weight:650}",
    ".om-diff{margin:0;overflow-x:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
    ".om-diff div{padding:0 10px;white-space:pre;min-width:100%;width:max-content}",
    ".om-del{background:#fdecec;color:#8a1f1f}.om-add{background:#e6f5ea;color:#17592f}",
    ".om-warn{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#fff6e0;color:#7a5200;font-size:12px}",
    ".om-pf{display:flex;align-items:center;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line,#dfe9df)}",
    ".om-st{flex:1;min-width:0;font-size:12px;color:var(--muted,#71867a);white-space:pre-wrap;word-break:break-all}",
    ".om-st.om-okc{color:#17592f}.om-st.om-errc{color:#8a1f1f}",
    ".om-st a{color:inherit;text-decoration:underline}",
    ".om-btn{height:38px;min-width:86px;padding:0 18px;border-radius:10px;border:1px solid var(--line,#dfe9df);background:#fff;color:#43506a;font-size:14px;font-weight:700;cursor:pointer}",
    ".om-btn.om-yes{background:var(--accent,#287447);color:#fff;border-color:transparent}",
    ".om-btn:disabled{opacity:.5;cursor:default}",
    "#om-both-start{height:30px;padding:0 12px;border:1px solid #d8cfee;border-radius:13px;background:#f2effb;color:#5d4a9b;font:inherit;font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer}",
    "#om-both-start:disabled{opacity:.55;cursor:wait}",
    "#om-both-status{flex:1 1 100%;min-width:0;font-size:11px;color:var(--muted,#71867a);white-space:pre-wrap;overflow-wrap:anywhere}",
    "#om-both-status a{color:inherit;text-decoration:underline}",
    ".om-file-actions{display:flex;gap:6px;padding:7px 10px;border-top:1px solid var(--line,#dfe9df)}",
    ".om-file-actions button,.om-history button{height:28px;padding:0 10px;border:1px solid var(--line,#dfe9df);border-radius:7px;background:#fff;color:#58725e;font-size:11px;cursor:pointer}",
    ".om-file-actions button.om-picked{background:#e3f3e5;color:#1f6b33;border-color:#9fd0a6}",
    ".om-file-actions button.om-rejected{background:#fbeeee;color:#8a1f1f;border-color:#e5b5b5}",
    ".om-layout{display:flex;min-height:0;flex:1;overflow:hidden}",
    ".om-tree{width:190px;flex:none;border-right:1px solid var(--line,#dfe9df);overflow:auto;padding:8px;background:#fbfdf9}",
    ".om-tree input{width:100%;height:30px;border:1px solid var(--line,#dfe9df);border-radius:7px;padding:0 7px;font-size:12px}",
    ".om-tree button{display:block;width:100%;padding:7px 5px;text-align:left;border:0;background:transparent;color:#4d6653;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}",
    ".om-tree button:hover{background:#edf5e8}",
    ".om-history{border-top:1px solid var(--line,#dfe9df);padding:8px 10px;max-height:160px;overflow:auto;font-size:11px}",
    ".om-history-row{display:flex;gap:8px;align-items:center;padding:5px 0}",
    ".om-history-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".om-preview-link{color:#287447;font-size:11px;text-decoration:underline;white-space:nowrap}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(css);

  /* ---------- 小提示 ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = document.getElementById("om-toast");
    if (!t) { t = el("div"); t.id = "om-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---------- 开关：输入框上面的一行小药丸 ---------- */
  var box = null, sel = null, hintEl = null, hint0 = null;
  function syncToggle() {
    if (!box) return;
    box.classList.toggle("om-on", state.on);
    box.setAttribute("aria-pressed", state.on ? "true" : "false");
    box.title = state.on ? "代码模式：开。点一下关闭" : "代码模式：关。打开后，发的消息会直接进入「改代码 → 预览 → 推 / 不推」流程";
    if (sel) sel.hidden = !state.on;
    if (hintEl) hintEl.hidden = !state.on;
    var inp = document.getElementById("inp");
    if (inp) { if (hint0 === null) hint0 = inp.getAttribute("placeholder") || ""; inp.setAttribute("placeholder", state.on ? "代码模式：说想改什么…" : hint0); }
  }
  function mountToggle() {
    if (document.getElementById("om-code-toggle")) return;
    box = el("button", "om-chip"); box.id = "om-code-toggle"; box.type = "button";
    box.appendChild(document.createElement("i")); box.appendChild(el("span", "", "代码模式"));
    sel = el("select"); sel.id = "om-code-project"; sel.setAttribute("aria-label", "代码模式要改的项目"); sel.disabled = true;
    sel.value = state.project;
    hintEl = el("span", "om-hint", "改完先预览，点「推」才推");
    var bothBtn = el("button", "", "同时启动"); bothBtn.id = "om-both-start"; bothBtn.type = "button";
    var bothStatus = el("span", ""); bothStatus.id = "om-both-status"; bothStatus.setAttribute("role", "status"); bothStatus.setAttribute("aria-live", "polite");
    var historyBtn = el("button", "om-refresh", "历史版本"); historyBtn.type = "button"; historyBtn.addEventListener("click", showHistory);
    bothBtn.addEventListener("click", startBoth);
    sel.addEventListener("change", function () { state.project = sel.value; ls(KEY_PROJ, state.project); currentPending = null; hide(); toast("代码模式：现在改「" + state.project + "」"); refreshPending(true); });
    box.addEventListener("click", function () {
      state.on = !state.on; ls(KEY_ON, state.on ? "1" : "0"); syncToggle();
      if (state.on) { toast("代码模式已开：之后每条消息都直接改「" + state.project + "」的代码"); check(); }
      else { toast("代码模式已关：回到普通聊天"); hide(); }
    });
    var inner = document.getElementById("composer-inner");
    if (inner) {
      var bar = el("div"); bar.id = "om-code-bar"; bar.appendChild(box); bar.appendChild(sel); bar.appendChild(hintEl); bar.appendChild(bothBtn); bar.appendChild(historyBtn); bar.appendChild(bothStatus);
      inner.insertBefore(bar, inner.firstChild);   // 放在输入框区域最上面；输入框收起时它也跟着收起
    } else { box.classList.add("om-float"); document.body.appendChild(box); document.body.appendChild(sel); sel.style.cssText = "position:fixed;left:130px;bottom:94px;z-index:999"; }   // 页面上没有输入框区域时的备用位置
    syncToggle();
  }

  /* ---------- 主页「同时启动」事件按钮：直接触发 Pages + Worker 后端任务 ---------- */
  var bothPollTimer = 0, bothBusy = false, bothButton = null, bothStatusNode = null;
  function setBothStatus(message, href) {
    if (!bothStatusNode) return;
    while (bothStatusNode.firstChild) bothStatusNode.removeChild(bothStatusNode.firstChild);
    bothStatusNode.appendChild(document.createTextNode(String(message || "")));
    if (href && /^https:\/\//.test(href)) {
      bothStatusNode.appendChild(document.createTextNode(" · "));
      var a = el("a", "", "查看 Actions"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      bothStatusNode.appendChild(a);
    }
  }
  function bothStateLabel(j) {
    var runs = Array.isArray(j && j.runs) ? j.runs : [];
    var parts = runs.map(function (r) {
      var name = r.kind === "worker" ? "Worker" : "Pages";
      var status = r.conclusion || r.status || "queued";
      return name + "：" + status;
    });
    return (j.state || j.status || "queued") + (parts.length ? "（" + parts.join("；") + "）" : "");
  }
  function refreshBothStatus(quiet) {
    return api("/api/code/both", { method: "GET", cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: "状态响应无法解析（HTTP " + r.status + "）" }; }); })
      .then(function (j) {
        if (!j || !j.ok) { if (!quiet) setBothStatus(j && j.msg || "读取部署状态失败"); return null; }
        var id = j.request_id || j.run_id || "任务编号暂不可用";
        setBothStatus("任务 " + id + " · " + bothStateLabel(j), j.actions_url || j.run_url);
        if (j.state === "success" || j.state === "failure") {
          if (bothPollTimer) clearInterval(bothPollTimer);
          bothPollTimer = 0;
          if (bothButton) { bothButton.disabled = false; bothButton.textContent = "同时启动"; }
        } else if (!bothPollTimer) {
          bothPollTimer = setInterval(function () { refreshBothStatus(true); }, 5000);
        }
        return j;
      })
      .catch(function (e) { if (!quiet) setBothStatus("状态读取失败：" + (e && e.message || e)); return null; });
  }
  function startBoth() {
    if (bothBusy) return;
    if (bothButton) { bothButton.disabled = true; bothButton.textContent = "启动中…"; }
    bothBusy = true; setBothStatus("正在请求后端启动 Pages + Worker…");
    api("/api/code/both", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main" }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: "服务器返回非 JSON 响应（HTTP " + r.status + "）" }; }); })
      .then(function (j) {
        if (!j || !j.ok) {
          setBothStatus((j && j.msg) || "同时启动失败" + (j && j.active_request_id ? " · 现有任务 " + j.active_request_id : ""));
          if (bothButton) { bothButton.disabled = false; bothButton.textContent = "同时启动"; }
          return;
        }
        var id = j.request_id || j.run_id || "任务编号暂不可用";
        setBothStatus("已提交任务 " + id + " · " + bothStateLabel(j), j.actions_url || j.run_url);
        if (!bothPollTimer && j.state !== "success" && j.state !== "failure") {
          bothPollTimer = setInterval(function () { refreshBothStatus(true); }, 5000);
        }
        refreshBothStatus(true);
      })
      .catch(function (e) {
        setBothStatus("启动请求失败：" + (e && e.message || e));
        if (bothButton) { bothButton.disabled = false; bothButton.textContent = "同时启动"; }
      })
      .finally(function () { bothBusy = false; if (bothButton && bothButton.textContent === "启动中…") { bothButton.disabled = false; bothButton.textContent = "同时启动"; } });
  }

  /* ---------- 开着代码模式时，聊天请求带上 code_mode ---------- */
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (state.on && /\/v1\/chat\/completions(?:[?#]|$)/.test(url) && init && typeof init.body === "string") {
        var b = JSON.parse(init.body);
        b.code_mode = true; b.code_project = state.project;
        if (panelState === "pending") hide();   // v108：新消息一发出，上一个没处理的预览就收掉（后端同时把它从 KV 里丢掉）
        var p = realFetch(input, Object.assign({}, init, { body: JSON.stringify(b) }));
        var after = function () { setTimeout(check, 300); };
        p.then(function (r) { try { r.clone().text().then(after, after); } catch (e) { after(); } }, function () {});
        return p;
      }
    } catch (e) { /* 改写失败就原样发，别影响正常聊天 */ }
    return realFetch(input, init);
  };

  /* ---------- 改动预览面板 ---------- */
  var panel = null, stEl = null, yesBtn = null, noBtn = null, fcBtn = null, footer = null, closeTimer = 0, expTimer = 0, reopenBtn = null, currentPending = null, panelCollapsed = false, refreshBusy = false;
  function ensurePanel() {
    if (panel) return panel;
    panel = el("div"); panel.id = "om-code-panel"; panel.hidden = true;
    panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "代码改动预览");
    document.body.appendChild(panel);
    reopenBtn = el("button", ""); reopenBtn.id = "om-code-reopen"; reopenBtn.type = "button"; reopenBtn.textContent = "▤ 查看待处理改动"; reopenBtn.setAttribute("aria-label", "重新打开代码改动预览");
    reopenBtn.addEventListener("click", function () { panelCollapsed = false; if (currentPending) render(currentPending); else refreshPending(true); });
    document.body.appendChild(reopenBtn);
    return panel;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function hide() { clearTimeout(closeTimer); clearTimeout(expTimer); if (panel) panel.hidden = true; if (reopenBtn) reopenBtn.classList.remove("on"); panelState = ""; panelCollapsed = false; currentPending = null; }
  function collapse() { clearTimeout(closeTimer); if (panel) panel.hidden = true; if (reopenBtn) reopenBtn.classList.add("on"); panelCollapsed = true; }
  function refreshPending(quiet) {
    if (refreshBusy) return Promise.resolve(); refreshBusy = true;
    if (stEl && !quiet) say("正在刷新待处理改动…");
    return api("/api/code/pending?repo=" + encodeURIComponent(state.project), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.pending && j.pending.edits && j.pending.edits.length) { currentPending = j.pending; render(j.pending); if (panelCollapsed) { panel.hidden = true; if (reopenBtn) reopenBtn.classList.add("on"); } }
      else { currentPending = null; hide(); if (!quiet) toast("当前没有待处理的改动"); }
    }).catch(function (e) { if (!quiet) toast("刷新失败：" + (e && e.message || e)); })
      .finally(function () { refreshBusy = false; });
  }
  function linkify(node, text) {   // 文字里的网址变成可点的链接（只处理 http / https）
    clear(node);
    String(text).split(/(https?:\/\/[^\s]+)/).forEach(function (part) {
      if (/^https?:\/\//.test(part)) { var a = el("a", "", part); a.href = part; a.target = "_blank"; a.rel = "noopener noreferrer"; node.appendChild(a); }
      else if (part) node.appendChild(document.createTextNode(part));
    });
  }
  function diffBox(old, nw) {
    var pre = el("div", "om-diff");
    String(old).split("\n").forEach(function (l) { pre.appendChild(el("div", "om-del", "- " + l)); });
    String(nw).split("\n").forEach(function (l) { pre.appendChild(el("div", "om-add", "+ " + l)); });
    return pre;
  }
  var fileDecision = {}, conflictChoices = {};
  function selectedPaths() { return Object.keys(fileDecision).filter(function (p) { return fileDecision[p] !== false; }); }
  function loadHistory(host) {
    api("/api/code/history?repo=" + encodeURIComponent(state.project), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      clear(host);
      (j.history || []).filter(function (h) { return h && h.commit_sha; }).slice(0, 30).forEach(function (h) {
        var row = el("div", "om-history-row");
        row.appendChild(el("span", "", (h.commit_sha || "").slice(0, 12) + " · " + (h.at || "时间未知") + " · " + (h.summary || "代码修改") + " · " + (h.files || []).join(", ")));
        var b = el("button", "", "回滚"); b.type = "button";
        b.addEventListener("click", function () {
          if (!window.confirm("确定创建新回滚提交，恢复到这个版本之前的文件内容？不会重写或删除 main 历史。")) return;
          b.disabled = true;
          api("/api/code/rollback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.id, repo: String(h.repo || state.project) }) })
            .then(function (x) { return x.json(); }).then(function (d) { toast(d.reply || d.msg || (d.ok ? "回滚提交已创建" : "回滚失败")); if (d.ok) loadHistory(host); else b.disabled = false; })
            .catch(function () { b.disabled = false; toast("回滚请求失败，结果未确认"); });
        });
        row.appendChild(b); host.appendChild(row);
      });
      if (!(j.history || []).some(function (h) { return h && h.commit_sha; })) host.appendChild(el("div", "om-meta", "暂无已推送版本"));
    }).catch(function () { clear(host); host.appendChild(el("div", "om-meta", "历史版本读取失败")); });
  }
  function showHistory() {
    var root = ensurePanel(); clear(root); panelState = "history";
    var head = el("div", "om-ph"); head.appendChild(el("strong", "", "历史版本"));
    var close = el("button", "om-x", "×"); close.type = "button"; close.addEventListener("click", hide); head.appendChild(close); root.appendChild(head);
    var list = el("div", "om-history"); list.style.maxHeight = "60vh"; root.appendChild(list); loadHistory(list); root.hidden = false;
  }
  function loadTree(host, p, body) {
    var search = el("input"); search.placeholder = "搜索文件…"; search.setAttribute("aria-label", "搜索文件"); host.appendChild(search);
    var list = el("div"); host.appendChild(list); var files = [];
    api("/api/code/tree?repo=" + encodeURIComponent(p.repo || "") + "&ref=" + encodeURIComponent(p.branch || p.baseBranch || "main"), { cache: "no-store" })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error(j && j.msg || "读取失败"); files = j.files || []; paint(); })
      .catch(function () { list.appendChild(el("div", "om-meta", "文件树读取失败")); });
    function paint() {
      clear(list); var q = search.value.trim().toLowerCase();
      files.filter(function (x) { return !q || x.toLowerCase().indexOf(q) >= 0; }).slice(0, 500).forEach(function (f) {
        var b = el("button", "", "▸ " + f); b.type = "button";
        b.addEventListener("click", function () {
          var cards = body.querySelectorAll(".om-edit"), target = null;
          Array.prototype.forEach.call(cards, function (card) { if (card.dataset.file === f) target = card; });
          if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        list.appendChild(b);
      });
    }
    search.addEventListener("input", paint);
  }
  function renderConflicts(items) {
    var root = ensurePanel(), old = root.querySelector(".om-conflicts"); if (old) old.remove();
    var box = el("div", "om-history om-conflicts"); box.appendChild(el("strong", "", "冲突合并"));
    (items || []).forEach(function (c) {
      var row = el("div", "om-history-row"); row.appendChild(el("span", "", c.path));
      ["mine", "theirs", "merge"].forEach(function (choice) {
        var b = el("button", conflictChoices[c.path] && conflictChoices[c.path].choice === choice ? "om-picked" : "", choice === "mine" ? "我的" : choice === "theirs" ? "对方版本" : "手动合并");
        b.type = "button";
        b.addEventListener("click", function () {
          var content = choice === "merge" ? window.prompt("请输入该文件完整的合并内容", c.merge || c.mine || c.theirs || "") : "";
          if (choice === "merge" && content === null) return;
          conflictChoices[c.path] = { choice: choice, content: content || "" }; renderConflicts(items);
        });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
    root.appendChild(box);
  }
  function render(p) {
    clearTimeout(closeTimer); clearTimeout(expTimer);
    currentPending = p; fileDecision = {}; (p.edits || []).forEach(function (e) { fileDecision[e.path] = true; });
    var root = ensurePanel(); clear(root); panelState = "pending";
    var head = el("div", "om-ph");
    head.appendChild(el("strong", "", "改动预览"));
    head.appendChild(el("span", "om-meta", (p.project || state.project) + " · " + p.branch + " · " + p.edits.length + " 处"));
    if (p.preview_url) { var pl = el("a", "om-preview-link", "临时预览"); pl.href = p.preview_url; pl.target = "_blank"; pl.rel = "noopener noreferrer"; head.appendChild(pl); }
    var refreshBtn = el("button", "om-refresh", "刷新 ↻"); refreshBtn.type = "button"; refreshBtn.addEventListener("click", function () { refreshPending(false); }); head.appendChild(refreshBtn);
    var touchY = null; head.addEventListener("touchstart", function (ev) { if (ev.touches && ev.touches.length === 1) touchY = ev.touches[0].clientY; }, {passive:true});
    head.addEventListener("touchend", function (ev) { if (touchY == null || !ev.changedTouches || !ev.changedTouches.length) return; var dy = ev.changedTouches[0].clientY - touchY; touchY = null; if (Math.abs(dy) > 42) refreshPending(false); }, {passive:true});
    fcBtn = el("button", "om-fc", "强制清空"); fcBtn.type = "button"; fcBtn.title = "删除本次临时分支并清除待处理记录"; fcBtn.addEventListener("click", forceClear); head.appendChild(fcBtn);
    var x = el("button", "om-x", "×"); x.type = "button"; x.setAttribute("aria-label", "收起改动预览"); x.addEventListener("click", collapse); head.appendChild(x); root.appendChild(head);
    var layout = el("div", "om-layout"), tree = el("aside", "om-tree"), body = el("div", "om-pb");
    loadTree(tree, p, body); layout.appendChild(tree);
    if (p.summary) { var s = el("div", "om-meta", "需求：" + p.summary); s.style.marginBottom = "8px"; s.style.whiteSpace = "normal"; body.appendChild(s); }
    (p.warn || []).forEach(function (w) { body.appendChild(el("div", "om-warn", "⚠️ " + w)); });
    (p.edits || []).forEach(function (e) {
      var card = el("div", "om-edit"); card.dataset.file = e.path;
      card.appendChild(el("div", "om-file", e.path + (e.line ? " · 第 " + e.line + " 行" : "")));
      card.appendChild(diffBox(e.old, e.new));
      var actions = el("div", "om-file-actions");
      var accept = el("button", "om-picked", "接受"), reject = el("button", "", "拒绝"); accept.type = reject.type = "button";
      accept.addEventListener("click", function () { fileDecision[e.path] = true; accept.className = "om-picked"; reject.className = ""; });
      reject.addEventListener("click", function () { fileDecision[e.path] = false; reject.className = "om-rejected"; accept.className = ""; });
      actions.appendChild(accept); actions.appendChild(reject); card.appendChild(actions); body.appendChild(card);
    });
    layout.appendChild(body); root.appendChild(layout);
    var hist = el("div", "om-history"); hist.appendChild(el("strong", "", "历史版本")); var histRows = el("div"); hist.appendChild(histRows); root.appendChild(hist); loadHistory(histRows);
    footer = el("div", "om-pf"); stEl = el("div", "om-st", "修改只写入临时分支；点推送后才合并到 main。");
    noBtn = el("button", "om-btn om-no", "丢弃"); noBtn.type = "button";
    yesBtn = el("button", "om-btn om-yes", "推送已接受文件"); yesBtn.type = "button";
    noBtn.addEventListener("click", function () { decide(false); }); yesBtn.addEventListener("click", function () { decide(true); });
    footer.appendChild(stEl); footer.appendChild(noBtn); footer.appendChild(yesBtn); root.appendChild(footer);
    root.hidden = !!panelCollapsed; if (reopenBtn) reopenBtn.classList.toggle("on", !!panelCollapsed); body.scrollTop = 0;
    var left = typeof p.left === "number" ? p.left : 10 * 60 * 1000;
    expTimer = setTimeout(function () { if (panelState !== "pending") return; hide(); toast("预览超过 10 分钟未处理，已自动丢弃"); clearOnServer().catch(function () {}); }, Math.max(1000, left));
  }
  function busy(b) { if (yesBtn) yesBtn.disabled = b; if (noBtn) noBtn.disabled = b; if (fcBtn) fcBtn.disabled = b; }
  function say(text, cls) { if (!stEl) return; stEl.className = "om-st" + (cls ? " " + cls : ""); linkify(stEl, text); }
  function showResult(text, ok, still, wasNo) {
    say(text, ok ? "om-okc" : "om-errc");
    if (still) { busy(false); if (yesBtn) yesBtn.textContent = "重试"; if (noBtn) noBtn.textContent = "丢弃临时分支"; panelState = "pending"; return; }   // 失败后保留分支和剩余修改，可直接重试
    clearTimeout(expTimer); panelState = "result";
    if (yesBtn) yesBtn.remove(); if (noBtn) noBtn.remove(); if (fcBtn) fcBtn.remove();
    var c = el("button", "om-btn", "关闭"); c.type = "button"; c.addEventListener("click", hide); footer.appendChild(c);
    if (wasNo && ok) closeTimer = setTimeout(hide, 1500);
  }
  function decide(yes) {
    var p = currentPending;
    if (!p || !(p.pending_id || p.id) || !Number.isInteger(Number(p.version)) || !p.project) {
      busy(false); say("预览信息不完整，请先刷新改动预览再操作。", "om-errc"); return;
    }
    var operationId = "studio-" + (window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
    var payload = {
      yes: !!yes,
      repo: String(p.repo || state.project),
      pending_id: String(p.pending_id || p.id),
      version: Number(p.version),
      project: String(p.project),
      operation_id: operationId,
      accepted_paths: yes ? selectedPaths() : null,
      conflict_resolutions: conflictChoices
    };
    busy(true); say(yes ? "正在接受并合并到 " + (p.baseBranch || "main") + "…" : "正在拒绝并删除临时修改…");
    api("/api/code/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, reply: "服务器返回的不是 JSON（HTTP " + r.status + "）" }; }); })
      .then(function (j) {
        var message = j.reply || j.msg || (j.ok ? "操作完成" : "操作失败");
        if (j.conflicts && j.conflicts.length) renderConflicts(j.conflicts);
        return api("/api/code/pending?repo=" + encodeURIComponent(state.project), { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (pj) {
          var still = !!(pj && pj.ok && pj.pending && pj.pending.edits && pj.pending.edits.length);
          if (still) currentPending = pj.pending;
          else if (j.ok) currentPending = null;
          showResult(message, !!j.ok, still, !yes);
        });
      })
      .catch(function (e) { showResult("请求失败：" + (e && e.message || e), false, true, !yes); });
  }

  /* ---------- v108：强制清空 / 自动过期时清服务器里的暂存 ---------- */
  function clearOnServer() {
    return api("/api/code/force-clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: String((currentPending && currentPending.repo) || state.project || "") }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: "服务器返回的不是 JSON（HTTP " + r.status + "）" }; }); });
  }
  function forceClear() {
    busy(true); say("正在清空…");
    clearOnServer().then(function (j) {
      if (j && j.ok === true) { hide(); toast("已强制清空，面板已关闭"); }
      else { busy(false); say((j && (j.reply || j.msg)) || "清空失败", "om-errc"); }
    }).catch(function (e) { busy(false); say("清空失败：" + (e && e.message || e), "om-errc"); });
  }

  /* ---------- 读取待推送的修改 ---------- */
  function check() {
    if (!state.on || !loggedIn()) return;
    refreshPending(true);
  }

  function init() { mountToggle(); var ready = loadProjects(); if (typeof document.getElementById === "function") { bothButton = document.getElementById("om-both-start"); bothStatusNode = document.getElementById("om-both-status"); if (bothStatusNode) refreshBothStatus(true); } Promise.resolve(ready).then(function () { if (state.on && PROJECTS.length) setTimeout(check, 800); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.omStudio = { state: state, check: check, hide: hide, enable: function () { if (!state.on && box) box.click(); }, disable: function () { if (state.on && box) box.click(); } };
})();
