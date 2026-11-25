async function codeChatEntry(env, user, text, history, o) {   // 返回 {ok, reply}；返回 null 表示这句话不归代码助手管，走原来的聊天。o 也可以直接传 true/false（= inCode，旧写法）
  o = o && typeof o === "object" ? o : { inCode: !!o };
  const kind = codeShortcutKind(text), inCode = !!(o.inCode || o.forced);
  if (kind === "confirm") {
    if (!inCode && !(env.KV && await env.KV.get("code:pend:" + user))) return null;
    return await codeConfirm(env, user, !/^\s*(不推|别推|取消)/.test(text));
  }
  if (o.forced || kind === "edit") {   // v105：开了代码模式（forced）就一定进来，不再猜这句话说了什么
    const nm = CODE_EDIT_RE.exec(String(text)), name = nm ? nm[1] : String(o.project || "");
    const proj = CODE_PROJECTS.find((p) => p.names.includes(name)) || CODE_PROJECTS.find((p) => p.names.includes("聚合体"));
    const req = String(text).replace(CODE_TRIGGER_RE, " ").replace(/^[\s,，:：、]+/, "").trim();
    return await codeProject(env, user, proj, req, history, !!o.ui);
  }
  return inCode ? await codeAssist(env, user, text, history) : null;
}
