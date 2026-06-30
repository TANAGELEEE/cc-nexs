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

## Standard Flow

> **Parallel workflow**: feature branches merge into test and master independently. Feature is based on master; test is only for integration verification. Never rebase onto origin/test — it pulls other unreleased features into your feature history, contaminating master on merge.

### Flow A: feature → test (deploy to test env)

```bash
# 1. Fetch latest target
git fetch origin test

# 2. Merge into target
git checkout test
git pull origin test
git merge --no-ff feature/{branch-name}

# 3. Push target
git push origin test
```

No rebase onto test. If conflicts arise, resolve on the test branch directly.

### Flow B: feature → master (release)

```bash
# 1. Fetch latest target
git fetch origin master

# 2. Rebase feature onto master
git checkout feature/{branch-name}
git rebase origin/master

# 3. If conflicts: resolve on feature, then git rebase --continue

# 4. Push rebased feature
git push --force-with-lease origin feature/{branch-name}

# 5. Merge into master
git checkout master
git pull origin master
git merge --no-ff feature/{branch-name}

# 6. Push master
git push origin master
```

---

## Pre-merge Checklist

- [ ] Deploy gate passed (if enabled)?
- [ ] No temp/merge branches created?
- [ ] **To test**: direct merge, no rebase onto origin/test?
- [ ] **To master**: rebased onto origin/master, build passes?
- [ ] Clean merge commit in target history?
