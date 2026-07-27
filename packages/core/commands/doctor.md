---
description: Validate workspace repositories, private overlay, and progress.json v2 files without changing project state.
allowed-tools: Read, Bash
argument-hint: [workspace-root]
---

# /cc-nexs:doctor

Resolve the installed plugin root and run:

```sh
node "${CC_NEXS_PLUGIN_ROOT}/lib/doctor.mjs" "${1:-$PWD}" ${2:-}
```

Pass `--release-test` for strict automatic-delivery readiness. Normal doctor reports missing optional release capabilities as warnings; strict mode treats them as errors before any remote mutation. Runtime browser availability, current signed-in state, and environment identity are checked again by `/cc-nexs:release-test` because the Node doctor cannot inspect model tool availability.

This command is read-only. Report every error before asking the user to repair configuration.
