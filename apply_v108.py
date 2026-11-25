#!/usr/bin/env python3
# apply_v108.py —— 防死循环（只改这一个功能）：
#   1) 待推送修改 10 分钟自动过期（KV TTL 3600 → 600，读的时候再核对一次时间）；
#   2) 代码模式里新消息一进来，自动丢掉上一个没处理的预览；
#   3) 新增 POST /api/code/clear（强制清空），/api/code/pending 额外返回剩余毫秒 left。
# 锚点必须恰好出现 1 次，对不上就报错退出；已经应用过会跳过。
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(p):
    with open(os.path.join(HERE, p), encoding="utf-8", newline="") as f:
        return f.read()


def die(msg):
    print("ERROR: " + msg)
    sys.exit(1)


s = rd("worker.js")
nl = "\r\n" if "\r\n" in s else "\n"

if "async function codePendGet(" in s and "/api/code/clear" in s:
    print("worker.js 已经有防死循环，跳过")
    sys.exit(0)


def blk(name):
    t = rd(os.path.join("v108", name)).replace("\r\n", "\n")
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


# 1) 先核对依赖
for need in ("async function codeConfirm(", "async function codeChatEntry(", "async function codeProject(", "CODE_PROJECTS"):
    if need not in s:
        die("worker.js 里缺少：" + need)

# 2) 辅助函数插在 codeConfirm 前面
ls = line_start(need_one("async function codeConfirm("))
s = s[:ls] + blk("pend_helpers.js") + s[ls:]

# 3) 存待推送修改时 KV 只留 10 分钟
rep("summary, warn, at: Date.now() }), { expirationTtl: 3600 });", "summary, warn, at: Date.now() }), { expirationTtl: 600 });")

# 4) codeConfirm：用带过期核对的读法；提示语改成 10 分钟
rep('const key = "code:pend:" + user, pend = env.KV ? await env.KV.get(key, "json") : null;', 'const key = "code:pend:" + user, pend = await codePendGet(env, user);')
rep("没有待推送的修改（可能放了超过 1 小时，已经过期）。", "没有待推送的修改（超过 10 分钟没点推 / 不推，已经自动丢弃了）。")

# 5) codeChatEntry：“推 / 不推”用带过期核对的读法；其他新消息进来先丢掉上一个没处理的预览
rep('if (!inCode && !(env.KV && await env.KV.get("code:pend:" + user))) return null;', 'if (!inCode && !(await codePendGet(env, user))) return null;')
rep('const nm = CODE_EDIT_RE.exec(String(text)), name = nm', 'await codePendClear(env, user);   // v108：新消息来了，上一个没处理的预览直接丢掉，不挡路' + nl + '    const nm = CODE_EDIT_RE.exec(String(text)), name = nm')
rep('return inCode ? await codeAssist(env, user, text, history) : null;', 'if (inCode) await codePendClear(env, user);   // v108：同上' + nl + '  return inCode ? await codeAssist(env, user, text, history) : null;')

# 6) /api/code/pending：用带过期核对的读法，并返回剩余毫秒 left（前端靠它到点自动收面板）
rep('const pend = env.KV ? await env.KV.get("code:pend:" + user, "json") : null;', 'const pend = await codePendGet(env, user);')
rep('at: pend.at, warn: pend.warn || [],', 'at: pend.at, left: Math.max(0, CODE_PEND_TTL_MS - (Date.now() - Number(pend.at))), warn: pend.warn || [],')

# 7) 新增 POST /api/code/clear
ls = line_start(need_one("// ---- 对话（SSE 流式）----"))
s = s[:ls] + blk("endpoint_clear.js") + s[ls:]

for t in ("async function codePendGet(", "async function codePendClear(", "/api/code/clear", "expirationTtl: 600", "CODE_PEND_TTL_MS"):
    if t not in s:
        die("改完之后缺少：" + t)
with open(os.path.join(HERE, "worker.js"), "w", encoding="utf-8", newline="") as f:
    f.write(s)
print("worker.js 已加入防死循环：10 分钟过期 / 新消息丢上一个 / /api/code/clear")
