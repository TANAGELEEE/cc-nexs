# Hotfix {id} · {feature-slug}
> This file is a read-only human view of `progress.json`; do not advance state through it directly. Machine state for new tasks lives in the workspace at `.cc-nexs/hotfixes/<key>/`, and the BUG document is designated by `progress.hotfix_document`; old tasks keep their original hotfix.md and state location.
## Current State

```yaml
current_state: INIT
updated_at: null
```

## State Skeleton
`INIT → HOTFIX_IMPLEMENTING → HOTFIX_IMPLEMENTED → HOTFIX_LOCAL_VERIFYING → HOTFIX_REVIEWING → HOTFIX_CANDIDATE_READY → HOTFIX_TEST_RELEASE → HOTFIX_TEST_VERIFYING → HOTFIX_RELEASE_PENDING_HUMAN → HOTFIX_BASE_MERGING → COMPLETE`

Any fix goes through `HOTFIX_LOCAL_REVERIFYING → HOTFIX_DELTA_REVIEW` at most once. Blocking again enters `HUMAN_INTERVENTION`. P3 likewise requires an independent Review. For a revision of the same fault already authorized by the user, use `revise-hotfix` to rebind on the original key/branch, preserve history, and clear the current evidence; do not manually change status or counts.
## History
- (None yet)
