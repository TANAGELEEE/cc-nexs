---
name: branch-gate
description: 分支来源门禁 — feature 分支必须从 origin/master（或配置的 protected_base）开出，禁止从 test/pre 拉分支。含检出后污染验证脚本。触发词：开分支、新分支、checkout、分支来源、branch。
---

# 分支来源门禁（Branch Origin Gate）

> 来源：NEX-68 生产事故（feature 从 test 开出，合并时带入其他需求代码）+ NEX-90 二次违规。

---

## 一、硬性禁令（违反即中止任务）

| # | 规则 |
|---|------|
| 1 | **所有新 feature 分支必须从 `origin/master`（或项目配置的 `protected_base`）开出** |
| 2 | **禁止从 `test` / `pre` / `release/*` 分支执行 `git checkout -b`** |
| 3 | **禁止 `git merge test` / `git rebase test` / `git cherry-pick` test 独有 commit 到 feature** |
| 4 | **`test` 只能作为测试环境集成目标，不能作为任何新分支的来源** |

---

## 二、创建新 feature 分支标准流程

```bash
# 1. 获取最新
git fetch origin

# 2. 基于 origin/master 创建
git checkout origin/master -b feature/{编号}-{短名}

# 3. 推送并设置上游
git push -u origin feature/{编号}-{短名}

# 4. 记录 base commit
git rev-parse origin/master
```

---

## 三、检出后强制验证

每次 checkout 后（无论新建分支还是恢复已有分支），**必须立即执行**：

```bash
git fetch origin

# 1. 确认 merge-base 在 origin/master 上
MERGE_BASE=$(git merge-base HEAD origin/master)
git branch -r --contains "$MERGE_BASE" | grep -q "origin/master" \
  && echo "PASS: base on master" \
  || echo "FAIL: base NOT on master"

# 2. 确认无 test 分支污染
CONTAMINATED=false
for commit in $(git log --format=%H origin/master..origin/test 2>/dev/null | head -10); do
  if git merge-base --is-ancestor "$commit" HEAD 2>/dev/null; then
    echo "FAIL: CONTAMINATED by test commit $commit"
    CONTAMINATED=true
    break
  fi
done
if [ "$CONTAMINATED" = false ]; then
  echo "PASS: no test contamination"
fi
```

**判定**：
- 任一 FAIL → 立即中止，报告问题，等待人工处理
- 全部 PASS → 记录验证结果，继续开发

验证结果格式：
```
## Branch Origin Verification
- merge-base: {commit_hash}
- master check: PASS/FAIL
- contamination check: PASS/FAIL
```

---

## 四、操作前自检（每次分支操作必过）

- [ ] 目标 base 是 `origin/master`（或 `protected_base`）？
- [ ] 当前不在 `test` / `pre` 分支上？（`git branch --show-current` 确认）
- [ ] 没有从 test/pre 分支 checkout -b？
- [ ] 恢复已有分支时，merge-base 在 master 上且无污染？

**任一不满足 → 停止操作，修正后重来。**

---

## 五、违规处置

| 情况 | 处理 |
|------|------|
| 从 test 检出已创建 commit | 从 origin/master 新建分支，cherry-pick 自己的 commit（排除 test 独有） |
| 已推送被污染分支 | 通知负责人，人工确认后 force-push 清理版本 |
| 合并了 test commit 到 feature | `git rebase --onto origin/master <污染点> feature/xxx` 重建 |
| 误从 test checkout | 删除该分支，从 origin/master 重新创建 |
