---
name: commit-self-push
description: 产出型角色必须自行 commit + push 产出物，未 push 视为未完成。Orchestrator 通过 git ls-tree 验证，不盲信声明。
---

# Commit 自律（Self-Push Discipline）

> 来源：Case-016 事故（SA 未推送产出物，Leader 代为提交触发全量删除）。

---

## 适用角色

所有"产出型"角色——即会写文件（文档/代码）的角色：
- planner / pm（产出 spec.md, requirements.md）
- tech-lead / developer / fullstack（产出代码、deploy.md、api-doc.md）
- sa / reviewer（产出 sa-review.md, sa-code-review.md）
- qa / verifier（产出 test-cases.md, test-report.md）
- repo-scout（产出 repo-context.md）

---

## 规则

### 1. 产出后立即自行提交

完成文档/代码编写后，**必须在同一轮次内**执行：

```bash
git add <产出文件路径>
git commit -m "<type>: <编号> <简述>"
git push origin <当前分支>
```

### 2. 自验推送成功

提交后**必须**验证远端可见：

```bash
git fetch origin <当前分支>
git ls-tree origin/<当前分支> <产出文件路径>
```

如果 `git ls-tree` 输出为空 → 推送失败，必须重试。

### 3. "未 push 视为未完成"

角色不得声称"已完成"而实际未推送。Orchestrator 将通过 `git ls-tree` 核实，而非信任声明。

---

## Orchestrator 验证协议

Orchestrator 在收到角色"完成"信号后：

```bash
git fetch origin <branch>
git ls-tree origin/<branch> <expected_artifact_path>
```

- 输出非空 → 确认完成，推进状态机
- 输出为空 → 重新 dispatch 给原角色，附带明确指令："你的 XX 文档未推送到 <branch>，请补推"

**绝对禁止**：Orchestrator 自行补写、补推、补提交任何角色的产出物。
