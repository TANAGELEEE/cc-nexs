---
description: Approve the spec at the single human checkpoint, transitioning state from SPEC_PENDING_HUMAN to SPEC_APPROVED.
allowed-tools: Read, Write, Edit, Bash
argument-hint: [feature_id]
---

# /cc-nexs:approve-spec

The G1 human checkpoint. G2 deployment approval remains a separate explicit checkpoint when enabled.

## Steps

1. Resolve the workspace docs assignment and locate `progress.json` plus its Markdown mirror.
2. Verify `progress.json.state == SPEC_PENDING_HUMAN`. If not, print current state and return.
3. Call `approveHumanGate(progressPath, {approver: $(git config user.name || echo 'unknown')})`
4. Transition state to `SPEC_APPROVED` via `transitionState(progressPath, {from: 'SPEC_PENDING_HUMAN', to: 'SPEC_APPROVED', reason: 'human approved'})`
5. Append a row to spec.md change log:
   ```
   | <YYYY-MM-DD> | Human approval | Direction confirmed after review pass | spec |
   ```
6. Print:
   ```
   ✅ Spec approved
      Feature: <id> <slug>
      Approver: <name>
      Approved at: <ts>
   ```
7. Auto-continue: immediately invoke `/cc-nexs:run <id>` to resume the pipeline from SPEC_APPROVED state. No manual re-run needed.
