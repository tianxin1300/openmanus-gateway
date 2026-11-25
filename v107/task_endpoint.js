    // ---- v107：任务拆解 POST /api/task/split {task, project?, save?} → 拆成 10 个一句话小任务，并追加写进仓库的 TODO.md（要登录；写入只有主人账号）----
    if (path === "/api/task/split" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = await userFromReq(request, env, url, String(b.token || ""));
      if (!user) return json({ ok: false, msg: "未登录，token失效" }, 401);
      const task = String(b.task || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (!task) return json({ ok: false, msg: "先写一个要拆的大任务" }, 400);
      const r = await taskSplit(env, task);
      if (!r.ok) return json(r, 502);
      const proj = CODE_PROJECTS.find((p) => p.names.includes(String(b.project || ""))) || CODE_PROJECTS.find((p) => p.names.includes("聚合体"));
      let saved = { ok: false, msg: "没有写入" };
      if (b.save !== false) { try { saved = await taskSave(env, user, proj, task, r.tasks); } catch (e) { saved = { ok: false, msg: String(e && e.message || e).slice(0, 120) }; } }
      return json({ ok: true, task, tasks: r.tasks, short: !!r.short, model: r.from, saved, repo: proj.repo, file: "TODO.md" });
    }

