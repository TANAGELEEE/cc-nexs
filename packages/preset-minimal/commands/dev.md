---
description: Invoke Developer subagent to implement, fix bugs, or sync docs.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
argument-hint: [feature_id] [--mode=feat|fix|doc] [--sprint=N | --bug=ID]
---

# /cc-nexs-minimal:dev

Invokes `agents/developer.md` via Task tool with subagent_type=general-purpose.

Steps:

1. Validate branch is `feature/...`, not master/main/test
2. If mode=feat or doc, ensure progress state == SPEC_APPROVED or SPRINT_*
3. Set `CC_NEXS_ROLE=developer`
4. Run subagent with mode-specific prompt
5. After return: build_cmd from preset.stack must succeed; forbidden_patterns scan must be clean
6. Commit per format `feat: <id> ...` / `fix(<module>): ... (BUG-<id>)` / `docs: ...`

Does not modify progress.md.
