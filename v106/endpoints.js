    // ---- v105：代码助手的预览面板接口（全部要登录）----
    //   GET  /api/code/pending → 当前待推送的修改（前端预览面板用）    POST /api/code/confirm {yes:true|false} → 推 / 不推（面板按钮用）
    if (path === "/api/code/pending" && request.method === "GET") {
      const user = await userFromReq(request, env, url, "");
      if (!user) return json({ ok: false, msg: "未登录，token失效" }, 401);
      const pend = env.KV ? await env.KV.get("code:pend:" + user, "json") : null;
      return json({ ok: true, pending: pend && Array.isArray(pend.edits) ? { repo: pend.repo, branch: pend.branch, summary: pend.summary, at: pend.at, warn: pend.warn || [], edits: pend.edits.map((e) => ({ path: e.path, line: e.line || 0, old: codeCut(e.old, 4000), new: codeCut(e.new, 4000) })) } : null });
    }
    if (path === "/api/code/confirm" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = await userFromReq(request, env, url, String(b.token || ""));
      if (!user) return json({ ok: false, msg: "未登录，token失效" }, 401);
      const yes = b.yes === true || b.yes === "true", no = b.yes === false || b.yes === "false";
      if (!yes && !no) return json({ ok: false, msg: "yes 必须是 true（推）或 false（不推）" }, 400);
      const r = await codeConfirm(env, user, yes);
      return json(r, r.ok ? 200 : 400);
    }

