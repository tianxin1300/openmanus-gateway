    // ---- v108：强制清空待推送的修改 POST /api/code/clear（要登录）。待推送的修改只存在 KV 里（点「推」之前 GitHub 上没建任何分支），清掉 KV 就是全部。----
    if (path === "/api/code/clear" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = await userFromReq(request, env, url, String(b.token || ""));
      if (!user) return json({ ok: false, msg: "未登录，token失效" }, 401);
      if (!env.KV) return json({ ok: false, msg: "KV 没有绑定" }, 500);
      const had = await codePendClear(env, user);
      return json({ ok: true, cleared: had, reply: had ? "已强制清空待推送的修改（KV 已清；GitHub 上本来就没有临时分支，不用去删）。" : "本来就没有待推送的修改。" });
    }

