---
description: "Safely migrate an existing Lean/Hotfix config.json to automatic risk-based model routing without removing explicit overrides."
disable-model-invocation: true
allowed-tools: "Read, Write, Bash"
argument-hint: "<feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]"
---

# /cc-nexs:migrate-feature-config

Resolve the installed plugin root and run the deterministic migration:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs migrate-feature-config <feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]
```

The migration adds and canonicalizes `risk_tier`. It removes `models.roles` only when the complete structured map exactly matches an old generated Lean/Hotfix template. Any partial or customized feature override is preserved and remains the final authority over automatic routing.

For an already approved legacy Lean plan whose Gateway A binding predates `risk_tier`, normal runtime routing derives the risk only when the current approval scope still matches its stored hash. If it cannot prove that risk, routing uses a conservative `high` floor instead of silently falling back to `medium`.

`--bind-plan-risk` explicitly materializes a hash-verified, concrete legacy plan risk into the existing Gateway A binding. It preserves the approval, original hashes, state and approver, and appends a dedicated migration event; it refuses stale, missing or ambiguous approval scopes. This is opt-in because `progress.json` is an approval record, not feature configuration. Preview it together with `--dry-run` first.

Run with `--dry-run` first when the feature config was manually curated. After migration, run `/cc-nexs:doctor`.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
