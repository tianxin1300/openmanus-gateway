    // ---- v109：开发台接口（只有主人账号）：POST /api/dev/start 触发 Actions（前端 build + Worker 预检并行）；GET /api/dev/status 最近一次运行 + job + step；GET /api/dev/log?job= 日志 + 报错行；GET /api/dev/chain 状态链 ----
    if (path.startsWith("/api/dev/")) {
      const au = await devAuth(request, env, url);
      if (au.err) return json({ ok: false, msg: au.err }, au.status);
      if (path === "/api/dev/start" && request.method === "POST") { const r = await devStart(env, au); return json(r, r.ok ? 200 : 502); }
      if (path === "/api/dev/status" && request.method === "GET") { const r = await devStatus(env, au); return json(r, r.ok ? 200 : 502); }
      if (path === "/api/dev/log" && request.method === "GET") { const r = await devLog(env, au, url.searchParams.get("job") || ""); return json(r, r.ok ? 200 : 502); }
      if (path === "/api/dev/chain" && request.method === "GET") return json(await devChain(env, au));
    }

