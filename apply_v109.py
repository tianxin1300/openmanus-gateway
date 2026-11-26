#!/usr/bin/env python3
# apply_v109.py —— 开发台：「同时启动」(Actions 两个 job 并行) + 状态链。只加新东西，不改防死循环的逻辑。
#   worker.js：新增 /api/dev/start|status|log|chain；codeConfirm 里记录 已生成 / 已验证 / 已提交（codeChainMark）。
#   index.html：在 tasks.js 后面加载 devrun.js。
# 锚点必须恰好出现 1 次，对不上就报错退出；已经应用过会跳过。
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(p):
    with open(os.path.join(HERE, p), encoding="utf-8", newline="") as f:
        return f.read()


def wr(p, s):
    with open(os.path.join(HERE, p), "w", encoding="utf-8", newline="") as f:
        f.write(s)


def die(msg):
    print("ERROR: " + msg)
    sys.exit(1)


s = rd("worker.js")
nl = "\r\n" if "\r\n" in s else "\n"


def blk(name):
    t = rd(os.path.join("v109", name)).replace("\r\n", "\n")
    if not t.endswith("\n"):
        t += "\n"
    return t.replace("\n", nl)


def need_one(sub):
    n = s.count(sub)
    if n != 1:
        die("锚点出现了 %d 次（需要恰好 1 次）：%r" % (n, sub[:70]))
    return s.index(sub)


def line_start(i):
    return s.rfind("\n", 0, i) + 1


def rep(old, new):
    global s
    need_one(old)
    s = s.replace(old, new, 1)


if "async function devChain(" in s and "/api/dev/chain" in s:
    print("worker.js 已经有开发台接口，跳过")
else:
    for need in ("async function codeConfirm(", "async function codePendGet(", "const codeGhHeaders", "function codePushGuard(", "userFromReq", "const CODE_PROJECTS"):
        if need not in s:
            die("worker.js 里缺少依赖：" + need + "（防死循环 v108 / 代码模式 v106 要先应用）")
    # 顺手修 v107 任务拆解里的超时写法：用标准的 AbortSignal.timeout，不依赖别处有没有 T()
    if "signal: T(25000)" in s:
        s = s.replace("signal: T(25000)", "signal: AbortSignal.timeout(25000)")
    ls = line_start(need_one("async function codeConfirm("))
    s = s[:ls] + blk("dev_helpers.js") + s[ls:]
    # 已验证：codeConfirm 里把改动重新套到最新文件上（codeApply）——对得上才继续，对不上就丢弃；这里只是把结果记下来
    rep('if (res.errs.length) { await env.KV.delete(key); return {',
        'await codeChainMark(env, user, { gen: { at: pend.at, summary: pend.summary, n: pend.edits.length }, ver: { at: Date.now(), ok: !res.errs.length, msg: res.errs.map((e) => e.msg).join("；").slice(0, 200) }, com: null }, true);' + nl
        + '  if (res.errs.length) { await env.KV.delete(key); return {')
    # 已提交：推送循环结束后记下结果
    rep('return { ok: true, pushed: true, reply: lines.join("\\n") };',
        'await codeChainMark(env, user, { com: { at: Date.now(), ok: lines.length > 0 && lines.every((l) => /^✅/.test(l)), repo: pend.repo, branch: pend.branch, paths, msg: lines.join(" | ").slice(0, 300) } });' + nl
        + '  return { ok: true, pushed: true, reply: lines.join("\\n") };')
    ls = line_start(need_one("// ---- 对话（SSE 流式）----"))
    s = s[:ls] + blk("dev_endpoints.js") + s[ls:]
    for t in ("async function devChain(", "async function devStatus(", "async function devLog(", "async function devStart(", "/api/dev/chain", "codeChainMark("):
        if t not in s:
            die("改完之后缺少：" + t)
    wr("worker.js", s)
    print("worker.js 已加入开发台接口（同时启动 / 状态 / 日志 / 状态链）")

if not os.path.exists(os.path.join(HERE, "frontend", "devrun.js")):
    die("找不到 frontend/devrun.js")
h = rd(os.path.join("frontend", "index.html"))
t0, t1, t2 = '<script src="studio.js"></script>', '<script src="tasks.js"></script>', '<script src="devrun.js"></script>'
if t2 in h:
    print("index.html 已经加载 devrun.js，跳过")
else:
    base = t1 if h.count(t1) == 1 else t0
    if h.count(base) != 1:
        die("index.html 里 %s 的数量不是 1：%d" % (base, h.count(base)))
    n2 = "\r\n" if "\r\n" in h else "\n"
    h = h.replace(base, base + n2 + t2)
    assert h.count(t2) == 1
    wr(os.path.join("frontend", "index.html"), h)
    print("index.html 已在 " + base + " 后面加载 devrun.js")
