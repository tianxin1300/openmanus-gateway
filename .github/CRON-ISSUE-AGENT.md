# Cron Issue Agent

This workflow is an external-cron-triggered queue worker for GitHub Issues.

## Queue
- Add `bot:ready` to an open issue to enqueue it.
- One issue is claimed per workflow run.
- The worker changes labels to `bot:running`, then `bot:done` or `bot:failed`.
- It posts the result as an issue comment and uploads a 30-day execution log artifact.
- A workflow concurrency group prevents overlapping runs in this repository.

## Required GitHub Actions secrets
Configure these repository secrets before enabling the external cron:

- `OPENMANUS_API_URL`: origin of the same Worker environment where the automation token was generated (for the current preview, `https://openmanus-gateway-pr60-preview.tianxinyuan881.workers.dev`; use the production Worker origin only after the production token endpoint is deployed).
- `OPENMANUS_USER_TOKEN`: an account token accepted by the existing OpenManus login/authentication layer. Do not put this token in the issue body, workflow YAML, or Cron-job URL.

The workflow calls `POST /v1/chat/completions` with `provider: "OpenRouter"` and `model: "claude-sonnet-4-5"` to enter the existing read-only code-assist route. It deliberately omits `code_mode: true`: that flag forces the project-edit pipeline, which can create a pending change preview and is not appropriate for this analysis-only agent. The selected Worker environment must have at least one provider key configured for the code-assist backend (`OPENROUTER_KEYS`, `GROQ_KEYS`/`GROQ_API_KEY`, or `NVIDIA_KEYS`). Provider keys stay on the Worker and are not sent from the GitHub workflow.

## External Cron-job setup
Create a job in your Cron-job service:
- Schedule: every 10 minutes.
- Method: POST.
- URL: `https://api.github.com/repos/tianxin1300/openmanus-gateway/actions/workflows/cron-issue-agent.yml/dispatches`
- Headers:
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer <GitHub token with Actions: write>`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- JSON body: `{"ref":"main"}`

Store the GitHub token in the Cron-job service's secret/credential store, not in a public URL. The GitHub token used by Cron-job only needs permission to dispatch this workflow; the workflow's own `GITHUB_TOKEN` handles issue labels and comments.

## Safety boundary
This first version is deliberately analysis-only. It can read an issue, call the existing code-mode backend, comment the result, and save logs. It does not push code, create/merge PRs, or deploy. The existing code-mode backend may require a valid logged-in user token. Do not enable the Cron-job until both Actions secrets are configured and a manual dispatch has succeeded.
