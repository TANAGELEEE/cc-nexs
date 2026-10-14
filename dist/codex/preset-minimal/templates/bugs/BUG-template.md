# BUG-{n} — {short title}

## Meta

| Field | Value |
|-------|-------|
| State | OPEN / FIXED / VERIFIED / WONTFIX |
| Severity | P0 / P1 / P2 / P3 |
| Source | sprint / hotfix |
| Found by | (name or 'reviewer') |
| Found at | YYYY-MM-DD |
| Fixed by | (name or 'developer') |
| Commit | (hash) |

## Symptom

(One paragraph: what's broken.)

## Reproduction steps

1.
2.

## Reproduction script

Path: `qa-scripts/BUG-{n}-repro.{sh|py|ts}` — must exit non-zero when bug exists.

```sh
#!/usr/bin/env bash
set -euo pipefail
# ...
```

## Root cause

(Pinpoint to file:line. Filled by Developer at fix time.)

## Fix

(What changed and why.)

## Why didn't tests catch this?

(Required answer. Drives a regression test.)

## Regression record

(Reviewer appends rounds here, never overwrites.)
