import fs from "node:fs/promises";
import path from "node:path";

const apiRoot = "https://api.github.com";
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const backend = String(process.env.OPENMANUS_API_URL || "").replace(/\/+$/, "");
const userToken = process.env.OPENMANUS_USER_TOKEN;
const requestedIssue = String(process.env.ISSUE_NUMBER || "").trim();
const runId = String(process.env.RUN_ID || "local");
const logDir = "agent-logs";
const logFile = path.join(logDir, `issue-agent-${runId}.log`);
const logLines = [];
const log = (event, details = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  logLines.push(line);
  process.stdout.write(line + "\n");
};
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json"
};
async function gh(route, options = {}) {
  const response = await fetch(apiRoot + route, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; } catch {}
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.slice(0, 800)}`);
  return data;
}
async function ensureLabel(name, color, description) {
  try {
    await gh(`/repos/${repository}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color, description })
    });
  } catch (error) {
    if (!String(error.message).includes("422")) throw error;
  }
}
async function labels(issueNumber, add, remove = []) {
  if (add.length) await gh(`/repos/${repository}/issues/${issueNumber}/labels`, {
    method: "POST", body: JSON.stringify({ labels: add })
  });
  for (const label of remove) {
    try {
      await gh(`/repos/${repository}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
    } catch (error) {
      if (!String(error.message).includes("404")) throw error;
    }
  }
}
async function comment(issueNumber, body) {
  await gh(`/repos/${repository}/issues/${issueNumber}/comments`, {
    method: "POST", body: JSON.stringify({ body })
  });
}
async function main() {
  if (!repository || !token || !backend || !userToken) throw new Error("Missing required environment configuration");
  await fs.mkdir(logDir, { recursive: true });
  await ensureLabel("bot:ready", "1d76db", "Queued for the OpenManus code-mode issue agent");
  await ensureLabel("bot:running", "fbca04", "Currently being processed by the OpenManus issue agent");
  await ensureLabel("bot:done", "0e8a16", "Processed by the OpenManus issue agent");
  await ensureLabel("bot:failed", "d93f0b", "Processing failed; inspect the workflow log before retrying");

  const query = requestedIssue
    ? `/repos/${repository}/issues/${encodeURIComponent(requestedIssue)}`
    : `/repos/${repository}/issues?state=open&labels=bot%3Aready&sort=created&direction=asc&per_page=1`;
  const found = await gh(query);
  const issue = Array.isArray(found) ? found.find(item => !item.pull_request) : found;
  if (!issue || issue.pull_request) {
    log("queue_empty");
    await fs.writeFile(logFile, logLines.join("\n") + "\n");
    return;
  }
  const issueLabels = (issue.labels || []).map(item => typeof item === "string" ? item : item.name);
  if (!requestedIssue && !issueLabels.includes("bot:ready")) {
    log("issue_not_ready", { issue: issue.number });
    await fs.writeFile(logFile, logLines.join("\n") + "\n");
    return;
  }
  if (issueLabels.includes("bot:running")) {
    log("issue_already_claimed", { issue: issue.number });
    await fs.writeFile(logFile, logLines.join("\n") + "\n");
    return;
  }

  await labels(issue.number, ["bot:running"], ["bot:ready", "bot:failed"]);
  log("issue_claimed", { issue: issue.number, title: issue.title });

  try {
    const prompt = [
      "这是由 GitHub Issues 队列提交给聚合体代码模式的自动化任务。",
      "请先阅读并理解任务要求，给出基于仓库事实的处理结果。",
      "本轮自动化只允许分析、定位、给出具体修复方案和验证步骤；不得推送文件、不得创建或合并 PR、不得部署、不得更改 main。",
      "如果任务要求直接改代码，请说明需要修改的文件、原因、预期行为和应补的测试，不要声称已经修改。",
      "只根据你实际能读取到的仓库上下文回答；无法读取的内容明确标注。",
      "",
      `仓库：${repository}`,
      `Issue：#${issue.number} ${issue.title}`,
      `Issue URL：${issue.html_url}`,
      "",
      issue.body || "（Issue 没有正文，请根据标题说明需要补充的信息。）"
    ].join("\n");
    const response = await fetch(`${backend}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        provider: "OpenRouter",
        stream: false,
        code_budget_ms: 420000,
        message: prompt,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(8 * 60 * 1000)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenManus backend ${response.status}: ${raw.slice(0, 1200)}`);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error("OpenManus backend returned non-JSON response"); }
    const answer = String(payload?.choices?.[0]?.message?.content || payload?.reply || "").trim();
    if (!answer) throw new Error("OpenManus code mode returned an empty response");
    if (/代码模型都没接上|没有可用的 OPENROUTER_KEYS|全部限流超时/.test(answer)) {
      const retryMessage = "全部限流超时，下一轮再试";
      log("model_pool_exhausted", { issue: issue.number, message: retryMessage, detail: answer.slice(0, 1400) });
      await labels(issue.number, ["bot:ready"], ["bot:running", "bot:failed"]);
      log("issue_requeued", { issue: issue.number, reason: "model_pool_exhausted" });
      return;
    }
    log("model_completed", { issue: issue.number, chars: answer.length });
    const safeAnswer = answer.length > 50000 ? answer.slice(0, 50000) + "\n\n（回复过长，完整日志见 Actions artifact。）" : answer;
    await comment(issue.number, [
      "### OpenManus 自动化处理结果",
      "",
      safeAnswer,
      "",
      "---",
      `自动化运行：${runId}`,
      "本轮仅分析，不会自动提交代码、合并 PR 或部署。"
    ].join("\n"));
    await labels(issue.number, ["bot:done"], ["bot:running", "bot:failed"]);
    log("issue_completed", { issue: issue.number });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1800);
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout|timed out|aborted/i.test(message);
    if (timedOut) {
      const retryMessage = "全部限流超时，下一轮再试";
      log("model_pool_exhausted", { issue: issue.number, message: retryMessage, error: message });
      await labels(issue.number, ["bot:ready"], ["bot:running", "bot:failed"]);
      log("issue_requeued", { issue: issue.number, reason: "model_timeout" });
      return;
    }
    log("issue_failed", { issue: issue.number, error: message });
    await comment(issue.number, `### OpenManus 自动化处理失败\n\n${message}\n\n请查看 Actions 运行日志；修复配置后可重新添加 \`bot:ready\` 标签重试。\n\n运行：${runId}`).catch(commentError => log("failure_comment_error", { error: String(commentError) }));
    await labels(issue.number, ["bot:failed"], ["bot:running"]);
    throw error;
  } finally {
    await fs.writeFile(logFile, logLines.join("\n") + "\n");
  }
}
main().catch(async error => {
  log("fatal", { error: String(error?.message || error) });
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(logFile, logLines.join("\n") + "\n");
  process.exitCode = 1;
});
