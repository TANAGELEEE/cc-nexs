---
name: branch-gate
description: Branch origin gate — feature branches must originate from origin/master (or configured protected_base). Prevents test/pre branch contamination.
---

# Branch Origin Gate

> Origin: NEX-68 production incident (feature branched from test, merged other features' code into production).

---

## Hard Rules (violation = abort task)

| # | Rule |
|---|------|
| 1 | **All new feature branches must originate from `origin/master`** (or configured `protected_base`) |
| 2 | **Never `git checkout -b` from `test` / `pre` / `release/*`** |
| 3 | **Never `git merge test` / `git rebase test` / cherry-pick test-only commits into feature** |
| 4 | **`test` is only a merge target, never a branch source** |

---

## Create Feature Branch

```bash
git fetch origin
git checkout origin/master -b feature/{id}-{slug}
git push -u origin feature/{id}-{slug}
```

---

## Post-checkout Verification

```bash
git fetch origin

# 1. Verify merge-base is on master
MERGE_BASE=$(git merge-base HEAD origin/master)
git branch -r --contains "$MERGE_BASE" | grep -q "origin/master" \
  && echo "PASS: base on master" \
  || echo "FAIL: base NOT on master"

# 2. Check for test contamination
CONTAMINATED=false
for commit in $(git log --format=%H origin/master..origin/test 2>/dev/null | head -10); do
  if git merge-base --is-ancestor "$commit" HEAD 2>/dev/null; then
    echo "FAIL: CONTAMINATED by test commit $commit"
    CONTAMINATED=true
    break
  fi
done
[ "$CONTAMINATED" = false ] && echo "PASS: no test contamination"
```

## Pre-operation Checklist

- [ ] Target base is `origin/master`?
- [ ] Not currently on `test` / `pre`?
- [ ] No `checkout -b` from test/pre?
- [ ] Existing branch: merge-base on master, no contamination?
