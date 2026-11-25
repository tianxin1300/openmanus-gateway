/* tasks.js —— 「任务拆解」按钮（Magic ToDo 式）
 * 在输入框里写一个大任务（比如：我要做挂号提醒），点「任务拆解」：
 *   1. 后端把它拆成 10 个一句话小任务，并追加写进仓库根目录的 TODO.md（只有主人账号能写）；
 *   2. 这里弹出清单：勾选要做的，点「做选中的」→ 自动打开代码模式，把这几步发给代码助手，改完在预览面板里点「推」或「不推」；
 *   3. 也可以直接在输入框里打：做第 1、2、3 个（或 做第 4 个 / 做第 1 到 3 个）。
 * 依赖 studio.js（代码模式开关和预览面板）。后端接口：POST /api/task/split
 */
(function () {
  "use strict";
  if (window.__omTasks) return;
  window.__omTasks = true;

  var KEY = "om_tasks", cur = null;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  try { cur = JSON.parse(ls(KEY) || "null"); } catch (e) { cur = null; }
  if (!cur || !Array.isArray(cur.tasks)) cur = null;

  function gw() { try { return typeof GATEWAY !== "undefined" ? GATEWAY : ""; } catch (e) { return ""; } }
  function api(path, opt) {
    var f = (typeof authFetch === "function") ? authFetch : function (u, o) {
      var h = new Headers((o && o.headers) || {}), t = ls("openmanus_token");
      if (t) h.set("Authorization", "Bearer " + t);
      return fetch(u, Object.assign({}, o, { headers: h }));
    };
    return f(gw() + path, opt || {});
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function project() { try { return (window.omStudio && window.omStudio.state.project) || "聚合体"; } catch (e) { return "聚合体"; } }

  var toastTimer = 0;
  function toast(msg) {
    var t = document.getElementById("om-toast");
    if (!t) { t = el("div"); t.id = "om-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  var css = document.createElement("style");
  css.id = "om-tasks-css";
  css.textContent = [
    ".om-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid #d9e7d7;border-radius:13px;background:#f1f7ee;color:#4d7d55;font:inherit;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}",
    ".om-chip:disabled{opacity:.6;cursor:default}",
    "#om-task-panel{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:min(760px,100%);max-height:78vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#19362a);border:1px solid var(--line,#dfe9df);border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -10px 34px rgba(16,41,31,.22);z-index:1000;font-size:13px;box-sizing:border-box}",
    "#om-task-panel *{box-sizing:border-box}",
    "#om-task-panel[hidden]{display:none}",
    ".omt-h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#dfe9df)}",
    ".omt-h strong{font-size:14px;white-space:nowrap}",
    ".omt-m{flex:1;min-width:0;color:var(--muted,#71867a);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".omt-x{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted,#71867a);font-size:20px;line-height:1;cursor:pointer}",
    ".omt-b{overflow:auto;padding:6px 14px;flex:1;min-height:56px}",
    ".omt-row{display:flex;align-items:flex-start;gap:10px;padding:9px 2px;border-bottom:1px solid var(--line,#eef3ec);cursor:pointer}",
    ".omt-row input{margin-top:3px;width:18px;height:18px;flex:none}",
    ".omt-n{flex:none;width:22px;font-weight:700;color:#287447}",
    ".omt-t{flex:1;min-width:0;line-height:1.5;word-break:break-word}",
    ".omt-f{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line,#dfe9df)}",
    ".omt-s{flex:1 1 100%;min-width:0;font-size:12px;color:var(--muted,#71867a);word-break:break-all}",
    ".omt-s.omt-ok{color:#17592f}.omt-s.omt-warn{color:#8a5a00}",
    ".omt-s a{color:inherit;text-decoration:underline}",
    ".omt-btn{height:38px;min-width:86px;padding:0 16px;border-radius:10px;border:1px solid var(--line,#dfe9df);background:#fff;color:#43506a;font-size:14px;font-weight:700;cursor:pointer}",
    ".omt-btn.omt-go{background:var(--accent,#287447);color:#fff;border-color:transparent}",
    ".omt-btn:disabled{opacity:.5;cursor:default}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(css);

  /* ---------- 按钮：放在输入框上面那一行（代码模式开关旁边） ---------- */
  var btn = null;
  function mount(tries) {
    if (document.getElementById("om-task-btn")) return;
    var bar = document.getElementById("om-code-bar");
    if (!bar && tries < 20) { setTimeout(function () { mount(tries + 1); }, 250); return; }
    btn = el("button", "om-chip", "任务拆解"); btn.id = "om-task-btn"; btn.type = "button";
    btn.title = "先在输入框写一个大任务，再点这里：拆成 10 个小任务并写进 TODO.md";
    btn.addEventListener("click", split);
    if (bar) bar.appendChild(btn);
    else { btn.style.cssText = "position:fixed;left:12px;bottom:130px;z-index:999"; document.body.appendChild(btn); }
  }

  function split() {
    var inp = document.getElementById("inp"), task = inp ? String(inp.value || "").trim() : "";
    if (!task) { toast("先在输入框里写一个大任务，比如：我要做挂号提醒"); return; }
    btn.disabled = true; btn.textContent = "拆解中…";
    api("/api/task/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: task, project: project(), save: true }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: "服务器返回的不是 JSON（HTTP " + r.status + "）" }; }); })
      .then(function (j) {
        if (!j || !j.ok) { toast((j && (j.msg || j.reply)) || "拆解失败"); return; }
        cur = { task: j.task, tasks: j.tasks, saved: j.saved || null, model: j.model || "", repo: j.repo || "", short: !!j.short };
        ls(KEY, JSON.stringify(cur)); render();
      })
      .catch(function (e) { toast("请求失败：" + (e && e.message || e)); })
      .then(function () { btn.disabled = false; btn.textContent = "任务拆解"; });
  }

  /* ---------- 清单面板 ---------- */
  var panel = null, boxes = [];
  function hide() { if (panel) panel.hidden = true; }
  function linkify(node, text) {
    clear(node);
    String(text).split(/(https?:\/\/[^\s]+)/).forEach(function (p) {
      if (/^https?:\/\//.test(p)) { var a = el("a", "", p); a.href = p; a.target = "_blank"; a.rel = "noopener noreferrer"; node.appendChild(a); }
      else if (p) node.appendChild(document.createTextNode(p));
    });
  }
  function render() {
    if (!cur) return;
    if (!panel) { panel = el("div"); panel.id = "om-task-panel"; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "任务拆解"); document.body.appendChild(panel); }
    clear(panel); boxes = [];
    var head = el("div", "omt-h");
    head.appendChild(el("strong", "", "任务拆解"));
    head.appendChild(el("span", "omt-m", cur.task));
    var x = el("button", "omt-x", "×"); x.type = "button"; x.setAttribute("aria-label", "关闭"); x.addEventListener("click", hide); head.appendChild(x);
    panel.appendChild(head);
    var body = el("div", "omt-b");
    cur.tasks.forEach(function (t, i) {
      var row = el("label", "omt-row"), cb = document.createElement("input"); cb.type = "checkbox"; boxes.push(cb);
      row.appendChild(cb); row.appendChild(el("span", "omt-n", String(i + 1))); row.appendChild(el("span", "omt-t", t)); body.appendChild(row);
    });
    panel.appendChild(body);
    var foot = el("div", "omt-f"), st = el("div", "omt-s");
    var sv = cur.saved;
    if (sv && sv.ok) { st.className = "omt-s omt-ok"; linkify(st, "已写进 " + (cur.repo || "") + " 的 TODO.md" + (sv.url ? "  " + sv.url : "")); }
    else { st.className = "omt-s omt-warn"; st.textContent = "没写进 TODO.md：" + ((sv && sv.msg) || "未知原因"); }
    if (cur.short) st.textContent += "（模型只给出了 " + cur.tasks.length + " 个，不足 10 个）";
    foot.appendChild(st);
    var all = el("button", "omt-btn", "全选"); all.type = "button";
    all.addEventListener("click", function () { var on = boxes.some(function (b) { return !b.checked; }); boxes.forEach(function (b) { b.checked = on; }); all.textContent = on ? "清空" : "全选"; });
    var go = el("button", "omt-btn omt-go", "做选中的"); go.type = "button";
    go.addEventListener("click", function () {
      var idx = []; boxes.forEach(function (b, i) { if (b.checked) idx.push(i); });
      if (!idx.length) { toast("先勾选要做的几步"); return; }
      run(idx);
    });
    foot.appendChild(all); foot.appendChild(go); panel.appendChild(foot);
    panel.hidden = false;
  }

  /* ---------- 开始做：打开代码模式，把选中的几步发给代码助手 ---------- */
  function compose(idx) {
    var lines = idx.map(function (i) { return (i + 1) + ". " + cur.tasks[i]; });
    return (idx.length === 1 ? "做下面这一步：\n" : "按顺序做下面 " + idx.length + " 步：\n") + lines.join("\n") + "\n（整体任务：" + cur.task + "）";
  }
  function ensureCodeMode() {
    if (!window.omStudio) return false;
    if (!window.omStudio.state.on) window.omStudio.enable();
    return true;
  }
  function run(idx) {
    var inp = document.getElementById("inp"), send = document.getElementById("send");
    if (!inp || !send) { toast("找不到输入框 / 发送按钮"); return; }
    if (!ensureCodeMode()) { toast("代码模式没有加载（studio.js），没法开始做"); return; }
    inp.value = compose(idx);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    hide(); send.click();
  }

  /* ---------- 直接在输入框打：做第 1、2、3 个 ---------- */
  var CMD_RE = /^\s*(?:请|帮我)?\s*(?:开始做|执行|做)\s*第?\s*([0-9一二两三四五六七八九十、,，和及到至~\-—\s]+?)\s*(?:个|步|条)?\s*[。.!！]?\s*$/;
  function parseNums(s, max) {
    var cn = { "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
    s = String(s).replace(/[一二两三四五六七八九十]/g, function (c) { return " " + cn[c] + " "; });
    var out = [], re = /(\d+)\s*(?:到|至|~|-|—)\s*(\d+)|(\d+)/g, m;
    function add(n) { if (n >= 1 && n <= max && out.indexOf(n - 1) < 0) out.push(n - 1); }
    while ((m = re.exec(s))) { if (m[1]) { var a = +m[1], b = +m[2]; for (var i = Math.min(a, b); i <= Math.max(a, b); i++) add(i); } else add(+m[3]); }
    return out.sort(function (a, b) { return a - b; });
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (cur && init && typeof init.body === "string" && /\/v1\/chat\/completions(?:[?#]|$)/.test(url)) {
        var b = JSON.parse(init.body), msgs = Array.isArray(b.messages) ? b.messages : [], li = -1;
        for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i] && msgs[i].role === "user") { li = i; break; }
        var txt = typeof b.message === "string" ? b.message : (li >= 0 && typeof msgs[li].content === "string" ? msgs[li].content : "");
        var m = CMD_RE.exec(txt || "");
        if (m) {
          var idx = parseNums(m[1], cur.tasks.length);
          if (idx.length && ensureCodeMode()) {
            var msg = compose(idx);
            if (typeof b.message === "string") b.message = msg;
            if (li >= 0 && typeof msgs[li].content === "string") msgs[li].content = msg;
            init = Object.assign({}, init, { body: JSON.stringify(b) });
          }
        }
      }
    } catch (e) { /* 改写失败就原样发 */ }
    return realFetch(input, init);
  };

  function init() { mount(0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.omTasks = { show: function () { if (cur) render(); }, split: split };
})();
