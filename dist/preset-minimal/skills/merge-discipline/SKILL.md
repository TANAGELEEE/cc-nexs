---
name: merge-discipline
description: Merge discipline — no temp branches, rebase before merge, resolve conflicts on the correct branch. Applies to all coding roles merging feature into test/main.
---

# Merge Discipline

> Origin: NEX-98 incident (agent created temp-test-merge branches causing git history chaos).

---

## Hard Rules (violation = abort merge)

| # | Rule |
|---|------|
| 1 | **Never create temporary branches for merging** (`temp-*`, `merge-*`, etc.) |
| 2 | **Never merge on a non-target branch then push to the target** |
| 3 | **Never `git push --force` to test / pre / main** (`--force-with-lease` only on feature branch after rebase) |
| 4 | **Resolve conflicts on the current branch**: rebase conflicts on feature, merge conflicts on target |

---

## Standard Flow (feature → test)

```bash
# 1. Fetch latest target
git fetch origin test

# 2. Rebase feature onto target
git checkout feature/{branch-name}
git rebase origin/test

# 3. If conflicts: resolve on feature, then git rebase --continue

# 4. Push rebased feature
git push --force-with-lease origin feature/{branch-name}

# 5. Merge into target
git checkout test
git pull origin test
git merge --no-ff feature/{branch-name}

# 6. Push target
git push origin test
```

---

## Pre-merge Checklist

- [ ] Deploy gate passed (if enabled)?
- [ ] On feature branch, ready to rebase?
- [ ] No temp/merge branches created?
- [ ] Build passes after rebase?
- [ ] Clean merge commit in target history?
