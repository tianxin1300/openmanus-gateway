async function codeProject(env, user, proj, req, history, ui) {
  const branch = String(env.CODE_PUSH_BRANCH || "main"), deadline = Date.now() + 170000, tag = proj.names[0];
  if (!req) return { ok: false, reply: "想改什么？比如：把顶栏某个按钮改成和旁边的按钮一个样式。（你现在在代码模式里，直接说就行。）" };
  if (!env.KV) return { ok: false, reply: "❌ KV 没有绑定，没法暂存待推送的修改" };
  const bad0 = codePushGuard(env, user, proj.repo, proj.files[0]);
  if (bad0) return { ok: false, reply: "⚠️ 不能改：" + bad0 };
  const files = {};
  for (const p of proj.files) {
    const g = await codeGetFile(env, proj.repo, p, branch);
    if (!g.ok) return { ok: false, reply: "❌ 读 " + proj.repo + " 的 " + p + " 失败：" + g.msg };
    if (g.exists) files[p] = g.text;
  }
  if (!Object.keys(files).length) return { ok: false, reply: "❌ " + proj.repo + "@" + branch + " 里没找到 " + proj.files.join(" / ") };
  // 对话记忆：之前的问答带给模型，找片段时也把前两句用户的话算进关键词（回答“蓝色”这种短句也能找回原来那段代码）
  const turns = (Array.isArray(history) ? history : []).filter((m) => m && (m.role === "user" || m.role === "assistant")).map((m) => ({ role: m.role, content: textOf(m.content).replace(/\s+/g, " ").trim().slice(0, 1200) })).filter((m) => m.content);
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();   // 末尾的用户话就是当前这句（req 里已有）
  const prior = turns.slice(-6), kwText = [req.slice(0, 300), ...prior.filter((m) => m.role === "user").slice(-2).map((m) => m.content.slice(0, 150))].join(" ");
  const bg = prior.length ? "【之前的对话（背景；你上一轮如果问过问题，我最新这句就是回答）】\n" + prior.map((m) => (m.role === "user" ? "用户：" : "你：") + m.content).join("\n") + "\n\n" : "";
  const sys = codeEditRules(proj), buildUser = (extra, note) => bg + "需求（最新一句）：" + req + "\n\n【相关片段】\n" + Object.keys(files).map((p) => codeShow(p, files[p], codePick(files[p], codeKeywords(kwText, extra), 16000))).join("\n") + (note || "");
  let extra = [], msgs = [{ role: "system", content: sys }, { role: "user", content: buildUser(extra) }], good = [], last = null, model = "", more = 0, fixes = 0, nudges = 0, res = { done: [], errs: [], out: files };
  for (let call = 0; call < 7; call++) {
    const r = await codeLLM(env, msgs, deadline - Date.now());
    if (!r.text) return { ok: false, reply: "❌ 代码模型都没接上：" + (r.tried.join("；") || "没有可用的 OPENROUTER_KEYS / GROQ_KEYS") };
    model = r.from; last = r.text;
    const fresh = codeParseEdits(r.text), ask = /(?:^|\n)\s*ASK\s*[:：]\s*([\s\S]+)/i.exec(r.text), need = /NEED_MORE\s*[:：]\s*(.+)/.exec(r.text);
    if (!fresh.length && !good.length && ask) return { ok: true, ask: true, model, reply: "❓ " + codeCut(ask[1].trim(), 700) + "\n\n（还在代码模式里，直接回答就行，我接着改。）\n（" + model + "）" };
    if (!fresh.length && need && more < 2) {   // 片段不够：按它点的名字再找一轮，重新给片段
      more++; extra = extra.concat(need[1].split(/[,，、;；\s]+/).filter((x) => x.length >= 2).slice(0, 12));
      msgs = [{ role: "system", content: sys }, { role: "user", content: buildUser(extra) }]; continue;
    }
    if (!fresh.length && !good.length) {
      if (nudges < 1 && Date.now() < deadline - 20000) {   // 既没改也没按规矩问：催一次，只能“直接改”或“只问一个问题”
        nudges++;
        msgs = msgs.concat([{ role: "assistant", content: r.text }, { role: "user", content: "不要列多个问题，也不要只做解释。二选一：1）按修改块格式直接改（需求笼统就参照片段里相邻元素的现有写法保持一致）；2）只有确实缺少必须由用户决定的信息，整条回复只写一行 ASK: 一个最关键的问题（最好带 2–3 个可选项）。" }]); continue;
      }
      return { ok: true, reply: codeCut(r.text, 1500) + "\n\n（还在代码模式里：这次没有产生修改块。把要求说得再具体一点，我接着改。）" };
    }
    const all = good.concat(fresh); res = codeApply(files, all);
    const bad = new Set(res.errs.map((e) => e.i)); good = all.filter((_, i) => !bad.has(i));
    if (res.errs.length && fixes < 2 && Date.now() < deadline - 20000) {   // 有块对不上：把原因和更精确的片段发回去，只让它重给失败的那几块
      fixes++;
      const failed = res.errs.map((e) => all[e.i]), ex2 = failed.flatMap((f) => String(f.old).match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) || []).slice(0, 12);
      msgs = msgs.concat([{ role: "assistant", content: r.text }, { role: "user", content: "有 " + res.errs.length + " 个修改块没能应用：\n" + res.errs.map((e) => "- 第 " + (e.i + 1) + " 块：" + e.msg).join("\n") + "\n其余块已经成功，不用重发。请只重新给出失败的那几块（SEARCH 要从下面的原文里一字不差地复制）。\n\n" + buildUser(extra.concat(ex2)) }]);
      continue;
    }
    break;
  }
  if (!good.length) return { ok: false, reply: "❌ 这次没能生成可用的修改：" + (res.errs.map((e) => e.msg).join("；") || "模型没有给出修改块") + "。换个说法再试一次。" };
  const final = codeApply(files, good), summary = req.replace(/\s+/g, " ").slice(0, 60);
  const warn = [...new Set(final.done.map((d) => d.path))].flatMap((p) => codeBalanceWarn(files[p], final.out[p]).map((w) => p + " 的 " + w + " 数量和原来不一致"));
  await env.KV.put("code:pend:" + user, JSON.stringify({ repo: proj.repo, branch, edits: good.map((g, i) => ({ path: final.done[i] ? final.done[i].path : g.path, line: final.done[i] ? final.done[i].line : 0, old: g.old, new: g.new })), summary, warn, at: Date.now() }), { expirationTtl: 3600 });
  const explain = String(last).replace(new RegExp(CODE_BLOCK_RE.source, "g"), "").replace(/```[^\n]*\n?/g, "").trim();
  const tail = (warn.length ? "\n\n⚠️ " + warn.join("；") + "（可能是括号写漏了，推之前请留意）" : "") + (res.errs.length ? "\n\n⚠️ 另有 " + res.errs.length + " 处没能应用，已跳过。" : "");
  const where = "（推到 " + proj.repo + "@" + branch + "，推上去 Cloudflare 会自动重新部署）\n（" + model + "）";
  const head = explain ? codeCut(explain, 300) + "\n\n" : "";
  if (ui) return { ok: true, pending: true, model, reply: head + "已生成 " + final.done.length + " 处改动（" + tag + "）：\n" + final.done.map((d, i) => (i + 1) + ". " + d.path + " 第 " + d.line + " 行").join("\n") + tail + "\n\n预览在面板里，点「推」或「不推」。" + where };
  return { ok: true, pending: true, model, reply: head + "改动预览（" + tag + "，共 " + final.done.length + " 处）：\n" + final.done.map((d, i) => (i + 1) + ". " + d.path + " 第 " + d.line + " 行\n- " + codeCut(d.old, 400).replace(/\n/g, "\n- ") + "\n+ " + codeCut(d.new, 400).replace(/\n/g, "\n+ ")).join("\n\n") + tail + "\n\n要推上去吗？回「推」或「不推」。" + where };
}
