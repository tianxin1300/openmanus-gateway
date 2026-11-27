# PR #60 isolated automatic repair smoke

This marker commit triggers the explicitly gated `[repair-smoke]` job in `pr60-stack-preview.yml`.

The job intentionally creates a failing test only in the dedicated PR #60 preview environment, sends the resulting Actions failure log to the configured model, checks the model's patch, re-runs verification, and deletes the temporary smoke branch. It must not merge or deploy to production.
