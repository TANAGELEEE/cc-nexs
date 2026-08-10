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
