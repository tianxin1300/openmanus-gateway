// ===== v107：任务拆解（Magic ToDo 式）=====
// 大任务 → 恰好 10 个一句话小任务（动词开头、能直接动手、按先后顺序）→ 追加写进仓库根目录 TODO.md。Groq 优先（快），不通再走代码模型兜底。
const TASK_SPLIT_PROMPT = "你是“Magic ToDo”式的任务拆解助手。用户给你一个大任务，你把它拆成【恰好 10 个】小任务。规则：1）每个小任务只写一句话，以动词开头，是能直接动手去做的一步，不要写“考虑 / 了解 / 思考 / 研究一下”这种做不完的词；2）按真正做事的先后顺序排；3）每步小到一次就能做完（大约 5 到 30 分钟），不要把两件事塞进一句；4）要具体到这件事本身（写出具体的页面、字段、按钮、时间、对象），不要空话；5）不要编号、不要解释、不要开场白。只输出一个 JSON 数组，里面恰好 10 个字符串。";
function taskParse(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  let arr = null;
  const m = /\[[\s\S]*\]/.exec(t);
  if (m) { try { const j = JSON.parse(m[0]); if (Array.isArray(j)) arr = j.map((x) => (typeof x === "string" ? x : (x && (x.task || x.text || x.title)) || "")); } catch (e) {} }
  if (!arr) arr = t.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+\s*[.、)）:：]?)\s*/, ""));
  return arr.map((x) => String(x).replace(/\s+/g, " ").replace(/^\[\s*[ xX]?\s*\]\s*/, "").trim()).filter((x) => x.length >= 2);
}
async function taskLLM(env, msgs) {
  const tried = [];
  for (const key of getKeys(env.GROQ_KEYS)) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: msgs, temperature: 0.3, max_tokens: 1200 }), signal: T(25000) });
      if (!r.ok) { tried.push("Groq HTTP " + r.status); continue; }
      const j = await r.json().catch(() => null), c = j && j.choices && j.choices[0];
      const text = c && c.message && typeof c.message.content === "string" ? c.message.content.trim() : "";
      if (text) return { text, from: "Groq · llama-3.3-70b-versatile", tried };
      tried.push("Groq 空回复");
    } catch (e) { tried.push("Groq " + (e && e.name === "TimeoutError" ? "超时" : String(e && e.message || e).slice(0, 60))); }
  }
  const r2 = await codeLLM(env, msgs, 45000);
  return { text: r2.text, from: r2.from, tried: tried.concat(r2.tried || []) };
}
async function taskSplit(env, task) {
  const base = [{ role: "system", content: TASK_SPLIT_PROMPT }, { role: "user", content: "大任务：" + task }];
  let msgs = base, best = [], from = "", tried = [];
  for (let i = 0; i < 2; i++) {
    const r = await taskLLM(env, msgs); tried = tried.concat(r.tried || []);
    if (!r.text) break;
    const list = taskParse(r.text); from = r.from;
    if (list.length > best.length || list.length === 10) best = list;
    if (list.length === 10) break;
    msgs = base.concat([{ role: "assistant", content: r.text }, { role: "user", content: "你给了 " + list.length + " 个，必须恰好 10 个。重新输出，只输出 JSON 数组。" }]);
  }
  if (best.length < 3) return { ok: false, msg: "拆解失败：模型没有给出可用的小任务" + (tried.length ? "（" + tried.join("；") + "）" : "") };
  return { ok: true, tasks: best.slice(0, 10), from, short: best.length < 10 };
}
async function taskSave(env, user, proj, task, tasks) {   // 追加到仓库根目录 TODO.md；只有主人账号能写（和代码模式推送同一套保护）
  const branch = String(env.CODE_PUSH_BRANCH || "main"), bad = codePushGuard(env, user, proj.repo, "TODO.md");
  if (bad) return { ok: false, msg: bad };
  const g = await codeGetFile(env, proj.repo, "TODO.md", branch);
  if (!g.ok) return { ok: false, msg: g.msg };
  const d = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const sec = "## " + task.slice(0, 80) + "（" + d + "）\n\n" + tasks.map((t, i) => "- [ ] " + (i + 1) + ". " + t).join("\n") + "\n";
  const text = g.exists ? g.text.replace(/\s+$/, "") + "\n\n" + sec : "# TODO\n\n" + sec;
  const up = await codeUpdateFile(env, proj.repo, "TODO.md", text, "AI: 任务拆解 " + task.slice(0, 40), branch, g.exists ? g.sha : "");
  return up.ok ? { ok: true, url: up.url || "", repo: proj.repo, branch } : { ok: false, msg: up.msg };
}
