---
name: merge-discipline
description: 合并纪律 — 禁止 temp 分支、合并前 rebase、冲突在目标分支直接解决。适用于所有编码角色合并 feature 到 test/main 的场景。触发词：merge、合并、test 分支、合入、上线。
---

# 合并纪律（Merge Discipline）

> 来源：NEX-98 事故（agent 创建 temp-test-merge 临时分支导致 git 历史混乱，合并记录无法追溯）。

---

## 一、硬性禁令（违反即中止合并）

| # | 规则 |
|---|------|
| 1 | **禁止创建任何临时分支来做合并**。包括但不限于 `temp-test-merge`、`temp-merge`、`temp-*`、`merge-*` 等命名 |
| 2 | **禁止在非目标分支上执行 merge 操作后再推送到目标分支** |
| 3 | **禁止 `git push --force` 到 test / pre / master/main**（`--force-with-lease` 仅限 feature 分支 rebase 后使用） |
| 4 | **冲突必须在当前操作的分支上直接解决**：rebase 冲突在 feature 上解决，merge 冲突在目标分支上解决 |

---

## 二、合并标准流程（feature → test）

### 前置条件

- SA 代码评审已通过（sa-code-review.md 结论: PASS）
- 如有数据库变更（DDL/DML），已在测试库执行 SQL 并确认成功

> **注意**：merge skill 执行的是 feature → test 合并，属于 G2 deploy gate 的**组成动作**——人工在此阶段合并代码、部署测试环境、然后 approve G2 放行 QA。G2 不是 merge 的前置条件，而是 merge + deploy 完成后的确认信号。

### 合并步骤

```bash
# 1. 拉取最新目标分支
git fetch origin test

# 2. 切到 feature 分支，rebase 到最新目标
git checkout feature/{branch-name}
git rebase origin/test

# 3. 如果 rebase 产生冲突，在 feature 分支上逐个解决
#    git add <resolved-files>
#    git rebase --continue

# 4. rebase 完成后 push feature 分支（覆盖旧历史）
git push --force-with-lease origin feature/{branch-name}

# 5. 切到目标分支执行 merge
git checkout test
git pull origin test
git merge --no-ff feature/{branch-name}

# 6. push 目标分支（此时应为干净的 --no-ff merge，无冲突）
git push origin test
```

### 步骤 5 极端情况（rebase 后 merge 仍有冲突）

这种情况极少发生（rebase 后到 merge 之间目标分支又被推送了新 commit）。处理方式：

```bash
# 在目标分支上直接解决冲突
git add <resolved-files>
git commit  # 完成 merge commit
git push origin test
```

**绝对禁止**：切出 temp 分支、在 temp 上 merge 再推回目标分支。

---

## 三、合并前 SQL 执行（如适用）

如果本次需求涉及数据库变更：

1. 从 spec 或 deploy 文档中获取 SQL 脚本
2. 在测试库执行 DDL/DML
3. 确认执行成功（无报错、影响行数符合预期）
4. 记录 SQL 执行结果

---

## 四、异常处理

| 情况 | 处理 |
|------|------|
| rebase 冲突无法自行解决 | 说明冲突文件和原因，等待人工指导 |
| merge 冲突无法自行解决 | `git merge --abort`，报告人工处理 |
| rebase 后发现编译失败 | 在 feature 分支修复编译问题，重新 push，再执行合并 |
| 误创建了 temp 分支 | 立即删除，回到标准流程重来 |

---

## 五、自检清单（每次合并前必过）

- [ ] 人工门禁已通过？（G2 deploy gate 如已启用）
- [ ] 如有 SQL，已在测试库执行成功？
- [ ] 当前在 feature 分支上，准备 rebase？
- [ ] 没有创建任何 temp / merge 临时分支？
- [ ] rebase 完成后编译/构建通过？
- [ ] merge 到目标分支后历史图干净（一个 merge commit）？
