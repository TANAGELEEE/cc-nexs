---
description: Approve the spec at the single human checkpoint, transitioning state from SPEC_PENDING_HUMAN to SPEC_APPROVED.
allowed-tools: Read, Write, Edit, Bash
argument-hint: [feature_id]
---

# /cc-nexs:approve-spec

The G1 human checkpoint. G2 deployment approval remains a separate explicit checkpoint when enabled.

## Steps

1. Resolve the installed plugin root containing this command. Run the deterministic control command; do not edit `progress.json` or `progress.md` directly:
   ```bash
   node "<plugin-root>/lib/cc-nexs-cli.mjs" approve-spec <feature_id>
   ```
   Claude Code resolves `<plugin-root>` from `CLAUDE_PLUGIN_ROOT`. Codex resolves it relative to the active mirror skill. Pi's registered command calls the same core implementation directly.
2. The control command verifies `progress.json.state == SPEC_PENDING_HUMAN`, records the G1 approval event, transitions to `SPEC_APPROVED`, and refreshes the Markdown mirror atomically. If validation fails, stop and print the error.
3. Never execute `/cc-nexs:approve-spec` as a shell path. It is a Claude Code/Pi command alias; Codex uses `$cc-nexs-approve-spec`; a regular shell uses `cc-nexs approve-spec`.
4. Append a row to spec.md change log:
   ```
   | <YYYY-MM-DD> | Human approval | Direction confirmed after review pass | spec |
   ```
5. Print:
   ```
   ✅ Spec approved
      Feature: <id> <slug>
      Approver: <name>
      Approved at: <ts>
   ```
6. Continue the current runtime's `run` workflow from `SPEC_APPROVED`. Do not launch the slash-style alias as a shell command.
