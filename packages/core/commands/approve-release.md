---
description: "Record Gateway B approval for an exact Lean/Hotfix candidate and its test evidence or authorized environment exception."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<id> [--test-exception --authorization-evidence <text> --reason <text> --environment-evidence <text> --rollback-evidence <text>]"
---

# /cc-nexs:approve-release

Lean/Hotfix human Gateway B. Resolve the packaged CLI and record the user's authorization:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs approve-release <feature-id-or-bug-key>
```

Normal approval requires Lean `RELEASE_PENDING_HUMAN` or Hotfix `HOTFIX_RELEASE_PENDING_HUMAN`, passed local verification and independent consolidated Review for the same candidate, and a verified test attempt. P3 also requires Review. Approval binds candidate commits, test attempt, environment revision, and the plan or Hotfix scope hash. Later candidate/scope changes invalidate it.

If the exact candidate was actually deployed to test but environment capability prevents verification, explicit user authorization may record an exception through this same gateway:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs approve-release <id> --test-exception \
  --authorization-evidence "<existing explicit user authorization>" \
  --reason "<reason for accepting the test-environment gap>" \
  --environment-evidence "<actual environment limitation evidence>" \
  --rollback-evidence "<owner, rollback action and proof>"
```

The exception requires exact-candidate passed local command evidence, passed independent Review, actual test integration/deployment evidence, and the latest attempt's `manual_required` result. A product verification failure, missing deployment, or missing evidence cannot use it. Preserve the unverified test status and record the exception in the approval binding; never relabel the attempt as passed. This approves configured base integration only, not production deployment. Do not request another confirmation when the necessary explicit user authorization is already present; record its evidence.

Continue with `/cc-nexs:run <id>` to integrate configured base branches. Production deployment requires its own applicable authorization.
