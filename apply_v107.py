#!/usr/bin/env python3
# apply_v107.py —— 加「任务拆解」：worker.js 新增 /api/task/split（拆 10 个小任务 + 写 TODO.md）；index.html 在 studio.js 后面再加载 tasks.js。
# 和 v106 一样：锚点必须恰好出现 1 次，对不上就报错退出；已经应用过就跳过，可以重复运行。
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


# ---------- worker.js ----------
s = rd("worker.js")
nl = "\r\n" if "\r\n" in s else "\n"


def blk(name):
    t = rd(os.path.join("v107", name)).replace("\r\n", "\n")
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


if "/api/task/split" in s and "async function taskSplit(" in s:
    print("worker.js 已经有任务拆解，跳过")
else:
    for need in ("async function codeLLM(", "async function codeGetFile(", "async function codeUpdateFile(", "function codePushGuard(", "const CODE_PROJECTS"):
        if need not in s:
            die("worker.js 里缺少依赖：" + need)
    ls = line_start(need_one("async function codeConfirm("))
    s = s[:ls] + blk("task_helpers.js") + s[ls:]
    ls = line_start(need_one("// ---- 对话（SSE 流式）----"))
    s = s[:ls] + blk("task_endpoint.js") + s[ls:]
    for t in ("/api/task/split", "async function taskSplit(", "async function taskSave("):
        if t not in s:
            die("改完之后缺少：" + t)
    wr("worker.js", s)
    print("worker.js 已加入 /api/task/split（拆 10 个小任务 + 写 TODO.md）")

# ---------- frontend/index.html ----------
if not os.path.exists(os.path.join(HERE, "frontend", "tasks.js")):
    die("找不到 frontend/tasks.js")
h = rd(os.path.join("frontend", "index.html"))
t1, t2 = '<script src="studio.js"></script>', '<script src="tasks.js"></script>'
if t2 in h:
    print("index.html 已经加载 tasks.js，跳过")
else:
    if h.count(t1) != 1:
        die("index.html 里 studio.js 的标签数量不是 1：%d" % h.count(t1))
    n2 = "\r\n" if "\r\n" in h else "\n"
    h = h.replace(t1, t1 + n2 + t2)
    assert h.count(t2) == 1
    wr(os.path.join("frontend", "index.html"), h)
    print("index.html 已在 studio.js 后面加载 tasks.js")
