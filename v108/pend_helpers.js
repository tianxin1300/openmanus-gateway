// ===== v108：防死循环 =====
// 待推送的修改只存在 KV 里（key = code:pend:用户），点「推」之前 GitHub 上没有任何临时分支。三道保险：
//   1) 只活 10 分钟（KV expirationTtl=600，读的时候再核对一次时间，过期当场删掉）；
//   2) 新消息进来（代码模式里的任何一句非推 / 不推）先把上一个没处理的预览丢掉；
//   3) POST /api/code/clear = 强制清空。
const CODE_PEND_TTL_MS = 10 * 60 * 1000;
async function codePendGet(env, user) {   // 读待推送的修改；超过 10 分钟 / 数据不完整的当场删掉，当作没有
  if (!env.KV) return null;
  const key = "code:pend:" + user, p = await env.KV.get(key, "json");
  if (!p) return null;
  if (!Array.isArray(p.edits) || !p.edits.length || !p.at || Date.now() - Number(p.at) > CODE_PEND_TTL_MS) { await env.KV.delete(key); return null; }
  return p;
}
async function codePendClear(env, user) {   // 清掉待推送的修改；返回“原来有没有”
  if (!env.KV) return false;
  const key = "code:pend:" + user, had = await env.KV.get(key);
  if (had != null) await env.KV.delete(key);
  return had != null;
}
