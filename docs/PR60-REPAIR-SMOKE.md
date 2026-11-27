# PR #60 isolated automatic repair smoke

This marker commit triggers the explicitly gated `[repair-smoke]` job in `pr60-stack-preview.yml`.

The job intentionally creates a failing test only in the dedicated PR #60 preview environment, sends the resulting Actions failure log to the configured model, checks the model's patch, re-runs verification, and deletes the temporary smoke branch. It must not merge or deploy to production.


Cleanup follow-up: the first smoke run exposed a GitHub REST path mismatch in temporary branch deletion (`git/ref` versus `git/refs`). The Worker endpoint and regression test now use `git/refs`; the next isolated preview run also deletes the one stale smoke branch and verifies GitHub returns HTTP 404. This cleanup-only marker does not trigger another model repair smoke.
