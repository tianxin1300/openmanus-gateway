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

- `OPENMANUS_API_URL`: base URL of the deployed OpenManus Gateway Worker, without a trailing slash.
- `OPENMANUS_USER_TOKEN`: an account token accepted by the existing OpenManus login/authentication layer. Do not put this token in the issue body, workflow YAML, or Cron-job URL.

The workflow calls the existing `POST /v1/chat/completions` route with `code_mode: true`. The model selection and provider keys therefore remain in the gateway's existing code-mode backend (the current code-mode model list and its configured provider keys); no second model list or provider API key is introduced in GitHub Actions.

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
