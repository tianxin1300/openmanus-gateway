#!/usr/bin/env python3
# apply_v106.py —— 把 v105「前端开关 + 对话记忆」的代码模式加到【当前 main 上的 worker.js】。
# 当前 worker.js 已经是 v101~v103 的状态（有 codeProject / codeConfirm / codeChatEntry / 肖恩AI），所以这里不用 git apply，
# 而是按“锚点 + 整段替换”改：每个锚点必须恰好出现 1 次，对不上就报错退出，绝不写半截。
# 新代码块放在 v106/ 目录里（纯 JS 文本）。已经应用过会自动跳过（可以重复运行）。
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(p):
    with open(p, encoding="utf-8", newline="") as f:
        return f.read()


def die(msg):
    print("ERROR: " + msg)
    sys.exit(1)


WP = os.path.join(HERE, "worker.js")
s = rd(WP)
nl = "\r\n" if "\r\n" in s else "\n"


def blk(name):
    t = rd(os.path.join(HERE, "v106", name)).replace("\r\n", "\n")
    if not t.endswith("\n"):
        t += "\n"
    return t.replace("\n", nl)


if "CODE_TRIGGER_RE" in s and "/api/code/pending" in s and "/api/code/confirm" in s:
    print("worker.js 已经带有 v105/v106 的代码模式，跳过")
    sys.exit(0)


def need_one(sub):
    n = s.count(sub)
    if n != 1:
        die("锚点出现了 %d 次（需要恰好 1 次）：%r" % (n, sub[:70]))
    return s.index(sub)


def line_start(i):
    return s.rfind("\n", 0, i) + 1


# 1) 文件头加一行 v105 说明
i = need_one("// v99w：1101 已定位修好")
ls = line_start(i)
hdr = "// v105：代码模式改成“前端开关 + 对话记忆”：请求带 code_mode:true 就一定进代码模式（不再猜措辞），追问只问一个问题并留在代码模式里；新增 /api/code/pending、/api/code/confirm 给前端 studio.js 的预览面板（推 / 不推按钮）用。" + nl
s = s[:ls] + hdr + s[ls:]

# 2) CODE_EDIT_RE：消息里任何位置出现“改聚合体 / 改就医伴侣”都算；另加 CODE_TRIGGER_RE 用来把口令从需求里去掉
i = need_one("const CODE_EDIT_RE = ")
le = s.index("\n", i)
new_re = (
    r"const CODE_EDIT_RE = /(?:修改|改一下|改)\s*(就医伴侣|聚合体)/;   // v105：消息里任何位置出现都算，不再要求在句首" + nl
    + r"const CODE_TRIGGER_RE = /(?:请|帮我|麻烦你?)?\s*(?:修改|改一下|改)\s*(?:就医伴侣|聚合体)\s*[,，:：、]?\s*/g;"
)
s = s[:i] + new_re + s[le:].replace("\r", "", 1) if s[le - 1:le] == "\r" else s[:i] + new_re + s[le:]

# 3) 提示词：需求笼统时参照相邻元素直接改，只有必须用户拍板才问一个问题（ASK:）；带上之前的对话
old = "块外只写一两句话说明改了什么。如果给的片段不够判断"
need_one(old)
new = (
    r"块外只写一两句话说明改了什么。\n需求笼统时（比如“改成统一视觉效果”），先看片段里相邻 / 同类元素现有的写法（class、颜色、尺寸），按“和它们保持一致”直接改，不要反问。"
    r"只有必须由用户拍板、片段里又找不到依据的信息（比如到底要换成哪种颜色），才提问：整条回复以 ASK: 开头，只问一个问题，最好给 2–3 个可选项，不要一次问多个问题。"
    r"用户消息里可能带有之前的对话：如果你上一轮问过问题，用户最新这句就是回答，直接据此修改。如果给的片段不够判断"
)
s = s.replace(old, new, 1)

# 4) 整段换掉 codeProject（带对话记忆 / ASK 追问 / 预览数据）
a = need_one("async function codeProject(")
b = need_one("async function codeConfirm(")
if not a < b:
    die("codeProject 应该在 codeConfirm 前面")
s = s[:a] + blk("code_project.js") + s[b:]

# 5) 整段换掉 codeChatEntry（code_mode 强制进代码模式）
a = need_one("async function codeChatEntry(")
b = s.index("// 前端带 stream:true", a)
if not 0 < b - a < 6000:
    die("codeChatEntry 的范围不对（%d）" % (b - a))
s = s[:a] + blk("code_entry.js") + s[b:]

# 6) POST /api/code：带上 code_mode
old = 'const r = await codeChatEntry(env, user, String(b.text == null ? (b.prompt || "") : b.text), b.history, true);'
need_one(old)
new = 'const r = await codeChatEntry(env, user, String(b.text == null ? (b.prompt || "") : b.text), b.history, { inCode: true, forced: b.code_mode === true, project: String(b.code_project || ""), ui: b.code_mode === true });'
s = s.replace(old, new, 1)

# 7) 新增 /api/code/pending 和 /api/code/confirm（插在“对话（SSE 流式）”前面）
i = need_one("// ---- 对话（SSE 流式）----")
ls = line_start(i)
s = s[:ls] + blk("endpoints.js") + s[ls:]

# 8) 聊天入口：请求里带 code_mode:true 就强制进代码模式
i = need_one("// v100/v101：代码助手。1)")
ls = line_start(i)
e = s.index("// v94：口令", i)
le = line_start(e)
if not 0 < le - ls < 5000:
    die("聊天入口那一段的范围不对（%d）" % (le - ls))
if "codeChatEntry(env, cu, lastText, msgs, codeIn)" not in s[ls:le]:
    die("聊天入口那一段和预期不一样，没有改")
s = s[:ls] + blk("chat_block.js") + s[le:]

# 自检
for t in ["CODE_TRIGGER_RE", "code_mode", "/api/code/pending", "/api/code/confirm", "codeForced", "async function codeProject(env, user, proj, req, history, ui)"]:
    if t not in s:
        die("改完之后缺少：" + t)
with open(WP, "w", encoding="utf-8", newline="") as f:
    f.write(s)
print("worker.js 已加入 v105 代码模式：code_mode 强制 / 对话记忆 / /api/code/pending / /api/code/confirm")
