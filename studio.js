/* studio.js —— 代码模式开关 + 改动预览面板（推 / 不推）
 *
 * 用法：在 index.html 里 </body> 前面加一行（只需加这一行，其余都在这个文件里）：
 *     <script src="studio.js"></script>
 *
 * 做三件事：
 *  1. 输入框上面加一个「代码模式」小药丸开关（颜色和旁边的「定位」药丸一致，手机上也在）。打开后，发给后端的每条聊天请求都带
 *     code_mode:true 和 code_project（聚合体 / 就医伴侣）。后端看到 code_mode 就一定进代码模式，不再猜你说了什么。
 *  2. 后端改完、生成了待推送的修改，就弹出「改动预览」面板：每处改动按 文件 + 行号 + 删除/新增 显示。
 *  3. 面板底下两个按钮：「推」→ 推到 GitHub；「不推」→ 丢弃。点一下就行，不用再打字回「推」。
 *
 * 后端接口（都要登录，沿用页面里的 authFetch / 登录 token）：
 *     GET  /api/code/pending          读取待推送的修改
 *     POST /api/code/confirm {yes}    yes:true = 推，yes:false = 不推
 */
(function () {
  "use strict";
  if (window.__omStudio) return;
  window.__omStudio = true;

  var KEY_ON = "om_code_mode", KEY_PROJ = "om_code_project", PROJECTS = ["聚合体", "就医伴侣"];
  var state = { on: false, project: window.OM_CODE_PROJECT || "聚合体" };
  var panelState = "";   // "" | "pending"（等你点推/不推）| "result"（已出结果，等你关掉）

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  state.on = ls(KEY_ON) === "1";
  var saved = ls(KEY_PROJ); if (saved && PROJECTS.indexOf(saved) >= 0) state.project = saved;
  if (PROJECTS.indexOf(state.project) < 0) state.project = "聚合体";

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
    ".om-x{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted,#71867a);font-size:20px;line-height:1;cursor:pointer}",
    ".om-x:hover{background:#eef3ec}",
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
    ".om-btn:disabled{opacity:.5;cursor:default}"
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
    if (typeof renderModelMenu === "function") renderModelMenu();
  }
  function mountToggle() {
    if (document.getElementById("om-code-toggle")) return;
    box = el("button", "om-chip"); box.id = "om-code-toggle"; box.type = "button";
    box.appendChild(document.createElement("i")); box.appendChild(el("span", "", "代码模式"));
    sel = el("select"); sel.id = "om-code-project"; sel.setAttribute("aria-label", "代码模式要改的项目");
    PROJECTS.forEach(function (p) { var o = el("option", "", p); o.value = p; sel.appendChild(o); });
    sel.value = state.project;
    hintEl = el("span", "om-hint", "改完先预览，点「推」才推");
    sel.addEventListener("change", function () { state.project = sel.value; ls(KEY_PROJ, state.project); toast("代码模式：现在改「" + state.project + "」"); });
    box.addEventListener("click", function () {
      state.on = !state.on; ls(KEY_ON, state.on ? "1" : "0"); syncToggle();
      if (state.on) { toast("代码模式已开：之后每条消息都直接改「" + state.project + "」的代码"); check(); }
      else { toast("代码模式已关：回到普通聊天"); hide(); }
    });
    var inner = document.getElementById("composer-inner");
    if (inner) {
      var bar = el("div"); bar.id = "om-code-bar"; bar.appendChild(box); bar.appendChild(sel); bar.appendChild(hintEl);
      inner.insertBefore(bar, inner.firstChild);   // 放在输入框区域最上面；输入框收起时它也跟着收起
    } else { box.classList.add("om-float"); document.body.appendChild(box); document.body.appendChild(sel); sel.style.cssText = "position:fixed;left:130px;bottom:94px;z-index:999"; }   // 页面上没有输入框区域时的备用位置
    syncToggle();
  }

  /* ---------- 开着代码模式时，聊天请求带上 code_mode ---------- */
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (state.on && /\/v1\/chat\/completions(?:[?#]|$)/.test(url) && init && typeof init.body === "string") {
        var b = JSON.parse(init.body);
        b.code_mode = true; b.code_project = state.project;
        var p = realFetch(input, Object.assign({}, init, { body: JSON.stringify(b) }));
        var after = function () { setTimeout(check, 300); };
        p.then(function (r) { try { r.clone().text().then(after, after); } catch (e) { after(); } }, function () {});
        return p;
      }
    } catch (e) { /* 改写失败就原样发，别影响正常聊天 */ }
    return realFetch(input, init);
  };

  /* ---------- 改动预览面板 ---------- */
  var panel = null, stEl = null, yesBtn = null, noBtn = null, footer = null, closeTimer = 0, currentPending = null;
  function ensurePanel() {
    if (panel) return panel;
    panel = el("div"); panel.id = "om-code-panel"; panel.hidden = true;
    panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "代码改动预览");
    document.body.appendChild(panel);
    return panel;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function hide() { clearTimeout(closeTimer); if (panel) panel.hidden = true; panelState = ""; }
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
  function render(p) {
    clearTimeout(closeTimer); currentPending = { pending_id: p.pending_id || p.id || "", version: Number(p.version), project: p.project || state.project };

    var root = ensurePanel(); clear(root); panelState = "pending";
    var head = el("div", "om-ph");
    head.appendChild(el("strong", "", "改动预览"));
    head.appendChild(el("span", "om-meta", (p.project || state.project) + " · 共 " + p.edits.length + " 处 · 目标 " + p.repo + "@" + p.branch + (p.status && p.status !== "awaiting_approval" ? " · " + p.status : "")));
    var x = el("button", "om-x", "×"); x.type = "button"; x.setAttribute("aria-label", "关闭预览（修改仍保留 1 小时）");
    x.addEventListener("click", hide); head.appendChild(x); root.appendChild(head);
    var body = el("div", "om-pb");
    if (p.summary) { var s = el("div", "om-meta", "需求：" + p.summary); s.style.marginBottom = "8px"; s.style.whiteSpace = "normal"; body.appendChild(s); }
    (p.warn || []).forEach(function (w) { body.appendChild(el("div", "om-warn", "⚠️ " + w + "（可能是括号写漏了，推之前请留意）")); });
    p.edits.forEach(function (e) {
      var card = el("div", "om-edit");
      card.appendChild(el("div", "om-file", e.path + (e.line ? " · 第 " + e.line + " 行" : "")));
      card.appendChild(diffBox(e.old, e.new)); body.appendChild(card);
    });
    root.appendChild(body);
    footer = el("div", "om-pf"); stEl = el("div", "om-st", "确认后写入 GitHub；线上部署状态需要单独确认。");
    noBtn = el("button", "om-btn om-no", "不推"); noBtn.type = "button";
    yesBtn = el("button", "om-btn om-yes", "推"); yesBtn.type = "button";
    noBtn.addEventListener("click", function () { decide(false); });
    yesBtn.addEventListener("click", function () { decide(true); });
    footer.appendChild(stEl); footer.appendChild(noBtn); footer.appendChild(yesBtn); root.appendChild(footer);
    root.hidden = false; body.scrollTop = 0;
  }
  function busy(b) { if (yesBtn) yesBtn.disabled = b; if (noBtn) noBtn.disabled = b; }
  function say(text, cls) { if (!stEl) return; stEl.className = "om-st" + (cls ? " " + cls : ""); linkify(stEl, text); }
  function showResult(text, ok, still, wasNo) {
    say(text, ok ? "om-okc" : "om-errc");
    if (still) { busy(false); panelState = "pending"; return; }   // 修改还在（比如被拦下没推成），按钮留着
    panelState = "result";
    if (yesBtn) yesBtn.remove(); if (noBtn) noBtn.remove();
    var c = el("button", "om-btn", "关闭"); c.type = "button"; c.addEventListener("click", hide); footer.appendChild(c);
    if (wasNo && ok) closeTimer = setTimeout(hide, 1500);
  }
  function operationId() { try { return "ui-" + crypto.randomUUID(); } catch (e) { return "ui-" + Date.now() + "-" + Math.random().toString(36).slice(2); } }
  function decide(yes) {
    busy(true); say(yes ? "正在推送…" : "正在丢弃…");
    var op = currentPending || {};
    api("/api/code/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yes: yes, pending_id: op.pending_id, version: op.version, project: op.project, operation_id: operationId() }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, reply: "服务器返回的不是 JSON（HTTP " + r.status + "）" }; }); })
      .then(function (j) {
        var text = j.reply || j.msg || (j.ok ? "完成" : "失败");
        return api("/api/code/pending").then(function (r) { return r.json(); }).then(function (pj) {
          var known = !!(pj && pj.ok), still = known ? !!(pj.pending && pj.pending.edits && pj.pending.edits.length) : true;
          showResult(known ? text : text + "\n状态暂时无法确认，修改仍保留，请稍后重试。", !!j.ok && known, still, !yes);
        }).catch(function () {
          showResult(text + "\n状态暂时无法确认，修改仍保留，请稍后重试。", false, true, !yes);
        });
      })
      .catch(function (e) { showResult("请求失败：" + (e && e.message || e), false, true, !yes); });
  }

  /* ---------- 读取待推送的修改 ---------- */
  function check() {
    if (!state.on || !loggedIn()) return;
    api("/api/code/pending").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.pending && j.pending.edits && j.pending.edits.length) render(j.pending);
      else if (panelState === "pending") hide();   // 已经没有待推送的了，旧面板收掉；显示结果的面板留着等你关
    }).catch(function () {});
  }

  function init() { mountToggle(); if (state.on) setTimeout(check, 800); }
  window.omStudio = { state: state, check: check, hide: hide, enable: function () { if (!state.on && box) box.click(); }, disable: function () { if (state.on && box) box.click(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
