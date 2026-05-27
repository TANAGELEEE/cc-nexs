---
description: Approve the spec at the single human checkpoint, transitioning state from SPEC_PENDING_HUMAN to SPEC_APPROVED.
allowed-tools: Read, Write, Edit, Bash
argument-hint: [feature_id]
---

# /cc-nexs:approve-spec

The only manual operation in the entire pipeline.

## Steps

1. Locate `progress.md` (same logic as `/cc-nexs:run`)
2. Verify `current_state == SPEC_PENDING_HUMAN`. If not, print current state and return.
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

   👉 Continue: /cc-nexs:run <id>
   ```

Does NOT auto-trigger /cc-nexs:run — give control back to the user to confirm next step.
