---
description: "Migrate a legacy human-readable progress.md into authoritative progress.json v2 while preserving progress.md as a rendered view."
disable-model-invocation: true
allowed-tools: "Read, Write, Bash"
argument-hint: "<path-to-progress.md> [--force]"
---

# /cc-nexs:migrate-progress

Resolve the installed plugin root and run:

```sh
node "${CC_NEXS_PLUGIN_ROOT}/lib/migrate-progress-cli.mjs" "$1" ${2:-}
```

Never overwrite an existing progress.json unless the user explicitly passed `--force`. After migration, run `/cc-nexs:doctor`.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
