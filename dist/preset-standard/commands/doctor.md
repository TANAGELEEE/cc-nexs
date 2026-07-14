---
description: Validate workspace repositories, private overlay, and progress.json v2 files without changing project state.
allowed-tools: Read, Bash
argument-hint: [workspace-root]
---

# /cc-nexs:doctor

Resolve the installed plugin root and run:

```sh
node "${CC_NEXS_PLUGIN_ROOT}/lib/doctor.mjs" "${1:-$PWD}"
```

This command is read-only. Report every error before asking the user to repair configuration.
