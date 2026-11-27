# Phase 2 — Workbench capability gap matrix

> Inventory snapshot: `code/workbench-acceptance-phase1-20261128` at `466aa1899cfce145e4b66fbaff2b4732c9d5454c`.
> This is a source-level inventory, not a claim that every feature has passed a live production test.
> Phase 1 PR #61 remains Draft and is not merged into `main`.

## Status definitions

- **Present** — implementation and relevant automated coverage exist.
- **Partial** — core implementation exists, but an identified scope or integration boundary remains.
- **Missing** — no implementation was found in the inspected source.
- **Unverified** — implementation exists, but the required live environment evidence was not produced.

## Capability matrix

| Phase 2 capability | Status | Source evidence / current boundary | Next acceptance target |
|---|---|---|---|
| AI task entry and code generation | Partial | Chat can enter code mode; `codeChatEntry` routes to `codeProject`; `codeLLM` calls OpenRouter, Groq and NVIDIA endpoints. The Phase 1 Actions suite mocks model fetches, so it does not prove a live model completed a real code task. | Run a separately identified, isolated live-model smoke task; record provider/model, request outcome, generated diff and branch without exposing keys. |
| Multi-project management | Partial | `CODE_PROJECTS`, `WORKBENCH_PROJECTS`, the Workbench project selector and `frontend/studio.js` project selector currently enumerate only “聚合体” and “就医伴侣”. `CODE_REPOS` is an allowlist, not a dynamic project registry or project-management UI. | Add a project registry and project lifecycle acceptance; preserve the repository allowlist as the write-security boundary. |
| Code editor and file review | Present / Partial | The deployed `frontend/index.html` Workbench has a file tree, search, file opening, editor save to temporary branch, diff review, per-file accept/reject, and project-switch dirty-state protection. Phase 1 tests cover UI behavior, but browser tests use API fixtures rather than live GitHub writes. | Add live isolated-repository coverage for opening, editing, saving, reviewing and discarding a second project. |
| Git branch and version control | Present / Unverified | Worker implements isolated branch create/save/preview/discard/merge, history and rollback, Durable Object write locks, base/head SHA checks and non-force CAS. Phase 1 has 220 Node tests plus two real GitHub API E2E checks; the E2E checks use disposable refs and confirm `main` is unchanged. Production Durable Object behavior is not established by those simulated storage tests. | Retain the existing safety gates; separately verify deployed Durable Object behavior before claiming production concurrency acceptance. |
| Automated test and task tracking | Partial | `test-project`, `verify-project`, deployment workflows, run index/status/log endpoints and retry logic exist. Run #513 verified test/build and E2E workflow execution on the Phase 2 fix branch. | Correlate each project + branch + task ID + commit SHA + Actions run; test retry and failure recovery across multiple repositories. |
| Per-project preview | Partial | Temporary Pages preview is implemented for `tianxin1300/openmanus-gateway`. The code path explicitly declines the independent preview dispatch for other project repositories; Workbench preview also gates on the OpenManus Gateway repository. | Define preview configuration per project; missing configuration must show “not configured”, never a fabricated URL. |
| Deployment and online health | Partial / Unverified | Pages and Worker deployment workflows and delivery-status routes exist. The Phase 2 fix branch was deployed only to an isolated Pages preview and checked for HTTP 200. No production deployment or production health check was performed in this work. | Keep Pages and Worker outcomes separate; require current-run correlation and a real health probe before marking a project healthy. |

## Phase 1 evidence carried into Phase 2

The Phase 1 acceptance branch has a successful recorded run:

- Run #508: 220 Node tests passed; build passed; GitHub branch/PR lifecycle E2E passed; Workbench merge-transaction GitHub API E2E passed.
- In that run, isolated Pages preview and Chromium/WebKit UI E2E were skipped. Do not infer they passed from Run #508.

A separate Phase 2 timeout fix is on Draft PR #65, based on the Phase 1 branch. Its Run #513 completed successfully:

- Node TAP: 221 tests, 221 passed, 0 failed, 0 skipped.
- `npm run build`: success.
- Chromium / iPhone 14: 10 passed.
- WebKit / iPhone 14: 10 passed.
- Disposable Pages preview: HTTP 200 and Playwright navigation HTTP 200.
- Real GitHub branch/PR lifecycle E2E: passed; disposable PR and refs cleaned; `main` SHA unchanged.
- Real GitHub Workbench merge-transaction E2E: passed; merge history, two parents, merged file, CAS conflict rejection and cleanup verified; `main` SHA unchanged.

Run #513: https://github.com/tianxin1300/openmanus-gateway/actions/runs/46083611287

Isolated branch preview run: https://github.com/tianxin1300/openmanus-gateway/actions/runs/46083640310

## Confirmed fix tracked separately

Draft PR #65 changes only:

- `worker.js`: caps each code-model request at 60 seconds (or the smaller remaining task budget).
- `tests/code-mode-providers.test.cjs`: verifies the 60-second cap and fallback to the next model after a timeout.

PR #65: https://github.com/tianxin1300/openmanus-gateway/pull/65

This change has passed Run #513. A live external model invocation was not part of that run.

## Next implementation dependency

The next major gap is dynamic multi-project management. Before changing the UI and backend, the project-registration source must be fixed. The secure default is to show only repositories allowed by `CODE_REPOS`; the remaining product choice is whether an authorized user adds a repository in the Workbench UI or the operator preconfigures repositories in the Worker environment and the UI lists them automatically.

## Safety boundary

- No changes to `main`; no production deployment.
- PR #61 remains Draft and unmerged.
- PR #65 remains Draft and unmerged.
- PR #32 and PR #60 are outside this work.
- Simulated GitHub/KV/DO tests are not labeled as live production verification.
