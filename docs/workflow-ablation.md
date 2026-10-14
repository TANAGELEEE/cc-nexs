# Workflow ablation

This change removes redundant controls, not independent Review or release authorization.
It is a deterministic regression experiment, not a measured model-speed benchmark.

| Removed behavior | Replacement | Check |
| --- | --- | --- |
| Any newer base requires a new tested candidate | Preserve the exact candidate; integrate disjoint base paths without another test attempt | Approval controller tests preserve test evidence and prove both source ancestries |
| Base path overlap can silently bypass revalidation | Keep `BASE_CHANGED` for overlapping paths | Negative test proves no push or candidate mutation |
| Public `init-hotfix` duplicates `hotfix` | `hotfix` calls the retained internal initialization controller | Hotfix lifecycle tests and cross-runtime entry validation |
| Codex imports both legacy commands and native adapters | Codex-only package with `command-docs/`, no legacy `commands/` discovery | Native document parity plus isolated installer smoke |
| Sprint line/commit quotas and automatic squash | AC/dependency-based slices; immutable verified candidates | Source cleanup, generated plugin parity |
| Sprint completion requires final test acceptance before delivery | Local completion, then requirement-level final acceptance | Existing final-only state-machine regression suite |

Keep `approve-plan`, `approve-spec`, `approve-deploy`, `approve-release`, migrations,
and role entry points: they still have live state-machine or compatibility callers.
Removing them would change supported modes or break recovery, not merely reduce duplication.
The internal `init-hotfix` CLI still creates safe worktrees and BUG state; it never reserves
a feature number or pushes a placeholder.

Limits: disjoint file paths cannot prove semantic independence. Known cross-file contracts,
schema/configuration dependencies, real conflicts, and changed candidates still require
affected validation. A concurrent push rejection remains recoverable, without force push.
Old in-flight tasks and their approved scope are not rewritten automatically. No elapsed-time,
token, or model-performance improvement is claimed without a comparable task replay.
