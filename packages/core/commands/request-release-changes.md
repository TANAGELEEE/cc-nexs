---
description: Record Gateway B feedback and route evidence-only, implementation, or scope changes safely.
allowed-tools: Read, Bash
argument-hint: [feature-id] --type=evidence|implementation|scope --feedback="..." [--ac=AC-001] [--path=src/...]
---

# /cc-nexs:request-release-changes

Lean/Hotfix Gateway B change request. Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs request-release-changes <feature-id> --type <kind> --feedback <text> [--ac <id>] [--path <path>]
```

The deterministic controller accepts only the mode-specific release-pending state, appends a structured row to Lean `plan.md` or Hotfix `hotfix.md`, keeps status synchronized, and retains old evidence as history.

- `evidence`: no code or AC change; remain at Gateway B.
- `implementation`: approved scope is unchanged; invalidate current candidate evidence and route through the same feature worktrees, local re-verification, one Gateway B delta Review, a new test attempt, test regression, and Gateway B again.
- `scope`: Lean appends to `requirements.md` and invalidates Gateway A. Hotfix rejects scope expansion; initialize a new Lean/Full change.

Never edit `progress.json` directly and never approve the release in the same invocation.
