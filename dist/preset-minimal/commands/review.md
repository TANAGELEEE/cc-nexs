---
description: Invoke Reviewer subagent for spec / code / acceptance review.
allowed-tools: Read, Write, Edit, Bash, Task
argument-hint: <target: spec|code|acceptance> [feature_id] [--sprint=N]
---

# /cc-nexs-minimal:review

Invokes `agents/reviewer.md` via Task tool.

Targets:

- `spec` → reviewer reads spec.md, appends to review.md
- `code` → orchestrator prepares diff to /tmp, reviewer reads diff, appends to code-review.md
- `acceptance` → reviewer reads spec.md + test results, appends to acceptance.md (black-box: forbid src/ + code-review.md reads via env)

Steps:

1. Validate inputs exist
2. For `code`: prepare diff via `git diff main...HEAD` filtered by preset.stack.src_paths
3. Set `CC_NEXS_ROLE=reviewer`
4. For `acceptance`, additionally set forbid-read env vars to enforce black-box
5. Invoke subagent with target-specific prompt
6. Parse conclusion line from output file
7. Print `RESULT:<conclusion>` for orchestrator consumption

Does not modify progress.md.
