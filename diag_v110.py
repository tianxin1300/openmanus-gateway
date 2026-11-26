#!/usr/bin/env python3
# diag_v110.py —— 只读诊断：把 worker.js / frontend/index.html / wrangler.toml 的现状、npm test / npm run build 的结果
# 写进 diag/report.txt 并推回 main（用 checkout 带的 GITHUB_TOKEN，不用任何自定义 secrets）。不改任何别的文件。
import os, re, subprocess, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
out = []


def rd(p):
    try:
        with open(os.path.join(HERE, p), encoding="utf-8", newline="") as f:
            return f.read()
    except Exception as e:
        return None


def cut(s, n=240):
    s = s.rstrip("\r")
    return s if len(s) <= n else s[:n] + "…"


def sec(title):
    out.append("")
    out.append("== " + title + " ==")


def sh(*a, timeout=240, cwd=None):
    try:
        r = subprocess.run(list(a), cwd=cwd or HERE, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return -1, str(e)


out.append("诊断时间(UTC): " + datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))
rc, txt = sh("git", "log", "--oneline", "-12")
sec("最近 12 个提交"); out.append(txt.strip())
rc, txt = sh("bash", "-c", "ls -la . .github/workflows tests frontend 2>&1 | head -80")
sec("文件"); out.append(txt.strip())

w = rd("worker.js")
sec("worker.js")
if w is None:
    out.append("读不到 worker.js")
else:
    lines = w.split("\n")
    out.append("%d 字节, %d 行, CRLF=%s" % (len(w.encode("utf-8")), len(lines), "\r\n" in w))
    out.append("-- 前 10 行 --")
    out += [cut(l, 200) for l in lines[:10]]
    routes = sorted(set(re.findall(r'path === "(/[^"]+)"', w)))
    out.append("-- 所有 path === 路由（%d 个）--" % len(routes))
    out.append(" ".join(routes))
    funcs = [n for n in re.findall(r'^(?:export )?(?:async )?(?:function|class) (\w+)', w, re.M) if re.match(r'(code|dev|task|verify|deploy|Code)', n)]
    out.append("-- code/dev/task/verify/deploy 开头的函数和类 --")
    out.append(" ".join(funcs))
    out.append("-- export class --")
    out.append(" ".join(re.findall(r'^export class (\w+)', w, re.M)))
    consts = re.findall(r'^const ((?:CODE|DEV|TASK|VERIFY)_\w+)', w, re.M)
    out.append("-- CODE_/DEV_/TASK_ 常量 --"); out.append(" ".join(consts))
    out.append("-- 我之前的补丁用到的锚点，在现在的 worker.js 里各出现几次 --")
    anchors = [
        "async function codeConfirm(", "async function codeProject(", "async function codeChatEntry(", "async function codeLLM(",
        "async function codeGetFile(", "async function codeUpdateFile(", "function codePushGuard(", "const CODE_PROJECTS", "const codeGhHeaders",
        "const CODE_EDIT_RE", "const CODE_TRIGGER_RE", "async function codePendGet(", "async function codePendClear(", "async function codeChainMark(",
        "async function taskSplit(", "async function devChain(", "/api/code/pending", "/api/code/confirm", "/api/code/clear", "/api/task/split", "/api/dev/chain",
        "code_mode", "// ---- 对话（SSE 流式）----", "code:pend:", "code:chain:", "codeCreateTempBranch", "codeMergeTempBranch", "codeDeleteBranch",
        "CODE_VERIFY_WORKFLOW", "CODE_DEPLOY_WORKFLOW", "expirationTtl: 3600", "expirationTtl: 600", "signal: T(25000)",
    ]
    for a in anchors:
        out.append("%3d  %s" % (w.count(a), a))
    for key in ("const WORK_MODELS = {", "const CODE_MODEL_ID ="):
        i = w.find(key)
        out.append("-- " + key + " --")
        if i >= 0:
            seg = w[i:i + 1500].split("\n")[:22]
            out += [cut(l, 260) for l in seg]
    i = w.find("async function codeConfirm(")
    out.append("-- codeConfirm 前 60 行 --")
    if i >= 0:
        seg = w[i:].split("\n")[:60]
        out += [cut(l, 260) for l in seg]
    out.append("-- 含 code:pend: 的行 --")
    for n, l in enumerate(lines, 1):
        if "code:pend:" in l:
            out.append("%d: %s" % (n, cut(l.strip(), 200)))

h = rd("frontend/index.html")
sec("frontend/index.html")
if h is None:
    out.append("读不到 frontend/index.html")
else:
    hl = h.split("\n")
    out.append("%d 字节, %d 行, CRLF=%s" % (len(h.encode("utf-8")), len(hl), "\r\n" in h))
    out.append("-- <script src=…> --")
    out += re.findall(r'<script[^>]*\bsrc="[^"]+"[^>]*>', h)
    out.append("-- id=\"wb-…\"（工作台）--")
    out.append(" ".join(sorted(set(re.findall(r'id="(wb-[\w-]+)"', h)))))
    for key in ("开发台", "renderDeliveryChain", "wb-both", "/api/code/verify", "/api/code/deploy", "/api/code/logs", "om-code-bar", "composer-inner"):
        ls = [n for n, l in enumerate(hl, 1) if key in l]
        out.append("%-22s %3d 处，行号 %s" % (key, len(ls), ls[:8]))
    out.append("-- 含「开发台」的行（前 6 行）--")
    k = 0
    for n, l in enumerate(hl, 1):
        if "开发台" in l and k < 6:
            out.append("%d: %s" % (n, cut(l.strip(), 220))); k += 1

sec("wrangler.toml"); out.append((rd("wrangler.toml") or "读不到").strip())
sec("package.json"); out.append((rd("package.json") or "读不到").strip())

sec("npm test（node --test tests/*.cjs）")
if os.path.isdir(os.path.join(HERE, "tests")):
    rc, txt = sh("node", "--version")
    out.append("node " + txt.strip())
    rc, txt = sh("node", "--test", "--test-reporter=spec", "tests/code-mode-providers.test.cjs", timeout=180)
    out.append("退出码 %s" % rc)
    if len(txt) > 20000:
        txt = txt[:5000] + "\n…（中间省略）…\n" + txt[-15000:]
    out.append(txt.strip())
else:
    out.append("没有 tests 目录")

sec("npm run build")
if rd("package.json"):
    rc, txt = sh("npm", "run", "build", "--silent", timeout=120)
    out.append("退出码 %s" % rc); out.append(txt.strip()[-3000:])

os.makedirs(os.path.join(HERE, "diag"), exist_ok=True)
with open(os.path.join(HERE, "diag", "report.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("诊断报告已写入 diag/report.txt（%d 行）" % len(out))

# 推回 main（只加 diag/report.txt）
sh("git", "config", "user.name", "github-actions[bot]")
sh("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
sh("git", "add", "diag/report.txt")
rc, txt = sh("git", "commit", "-m", "diag: worker.js / index.html / 测试 现状报告")
print(txt.strip()[:300])
if rc == 0:
    sh("git", "pull", "--rebase", "origin", "main")
    rc, txt = sh("git", "push", "origin", "HEAD:main")
    print("推送：" + ("成功" if rc == 0 else "失败 " + txt.strip()[:300]))
