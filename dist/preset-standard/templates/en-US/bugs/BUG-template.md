# BUG-{number} — {short description}
> **File naming rule**: `BUG-001.md`, `BUG-002.md`...
> **Reproduction script**: Must be in the same directory as this file or under `qa-scripts/`; plain-text descriptions are not accepted.
## Basic Information

| Field | Value |
|------|-----|
| Status | OPEN / FIXED / VERIFIED / WONTFIX |
| Severity | P0 / P1 / P2 / P3 |
| Source | sprint-qa / hotfix |
| Owning Sprint | M1 / M2 / ... (hotfix source may be empty)|
| Related Contract | AC-xxx（hotfix source may be empty）|
| Related Test Case | TC-M1-xxx |
| Discovered by | QA / User / Monitoring |
| Discovery Time | YYYY-MM-DD |
| Fixer | Tech Lead |
| Related commit | abcd1234 |
| Launched | Yes / No（launched P0/P1 must include rollback steps）|
| 升级历史 | 例如：P2 → P1（QA 第 2 轮回归仍然失败）|

## Symptoms
（A paragraph describing the bug's symptoms, including the error code, stack trace, and UI screenshot path.）
## Reproduction Steps
(Procedure steps, used together with the script below.)

1.
2.
3.
## Reproduction Script
Path: `qa-scripts/BUG-001-repro.sh` (or `BUG-001-repro.*` in the same directory)
```bash
#!/usr/bin/env bash
# This script must be executable; a non-zero exit code means the bug exists
set -euo pipefail

# ...
```

## Root Cause
(Tech Lead fills this in when fixing. Do not write "未知" before the investigation is complete — you must pinpoint file:line.)
## Fix Plan
（Filled in by the Tech Lead. Explain what changed in the code, why it was changed this way, and whether there are any side effects.）
## Impact Scope
- Affected interfaces:
- Affected data:
- Is data repair required:
## Review

<!-- For hotfix P2 / P0 / P1: append the lightweight SA Review here; do not create a separate sa-code-review.md. -->
     BUGs in the sprint process go through sa-code-review.md; leave this section blank. -->
### Round 1 — YYYY-MM-DD — Conclusion: PASS / NEEDS_REVISION
(SA review comments……)
## Regression Log
(Append during QA regression; do not overwrite history.)
### Round 1 — YYYY-MM-DD
- Script executed: `qa-scripts/BUG-001-repro.sh`
- Exit code: 0 (passed)
- Linked P0/P1 regression guards: TC-M1-001, TC-M1-002, TC-M1-003 all passed
- Status change: FIXED → VERIFIED
## Why the Original Test Missed It

<!-- Force an answer and drive filling in the missing test cases.
      After answering, you must append a new test case to test-cases.md (mark it 关联BUG: BUG-xxx). -->

(Required.)
## Release Impact / Rollback Steps

<!-- Required only for P0/P1 + launched. Other tiers may be left blank. -->
(If already live, describe whether production data needs fixing / rollback steps)
