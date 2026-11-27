import app, { CodeClaimDO } from "../worker.js";

export { CodeClaimDO };

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__e2e/")) {
      if (!env.WORKBENCH_E2E_SECRET || request.headers.get("x-workbench-e2e") !== env.WORKBENCH_E2E_SECRET) {
        return new Response("Not found", { status: 404 });
      }
      if (url.pathname.startsWith("/__e2e/do/")) {
        const action = url.pathname.slice("/__e2e/do/".length);
        if (!["branch-lock", "branch-renew", "branch-unlock"].includes(action)) return json({ ok: false }, 404);
        const body = await request.json().catch(() => ({}));
        if (!env.CODE_CLAIMS) return json({ ok: false, msg: "CODE_CLAIMS is not bound" }, 503);
        const id = env.CODE_CLAIMS.idFromName("e2e:" + String(body.repo || "probe").toLowerCase());
        const stub = env.CODE_CLAIMS.get(id);
        return stub.fetch("https://workbench-lock/" + action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      }
      if (url.pathname === "/__e2e/kv/history" && request.method === "GET") {
        if (!env.KV) return json({ ok: false, msg: "KV is not bound" }, 503);
        const rows = await env.KV.get("code:history:workbench-e2e", "json");
        return json({ ok: true, rows: rows || [] });
      }
      return json({ ok: false }, 404);
    }
    return app.fetch(request, env, ctx);
  }
};
