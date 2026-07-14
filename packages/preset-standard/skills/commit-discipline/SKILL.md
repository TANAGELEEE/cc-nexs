---
name: commit-discipline
description: cc-nexs commit 聚合与 sprint 收尾 squash 规则。避免一个需求 100+ commit 的反模式。触发词：commit、squash、rebase、sprint 收尾、合并、main、master、分支整理。
---

# Commit 纪律

## 三档时序

### 阶段 1：sprint 内小步提交

每个 sprint 内可分散提：
- code（实现 AC）
- fix（修 bug）
- doc-sync（同步 api/deploy）
- review-fix（按 SA 评审整改）

**单 sprint commit 数 ≤ 10**（硬指标，超了立即 squash）。

### 阶段 2：sprint 完成后里程碑级 squash

每个 sprint 通过 Evaluator 后，由 orchestrator 触发 `git rebase -i`，把 sprint 内所有 commit squash 成一个里程碑 commit：

```
feat: <编号> M<N> <模块名> - <一句话核心成果>
```

### 阶段 3：合并 main 前最终整理

整个 feature 合并到 main 前，最终 commit ≤ 10 个，按里程碑分组：

```
1. docs: <编号> spec + 验收契约          (第0-2步)
2. feat: <编号> M1 <模块>                 (M1 整体)
3. feat: <编号> M2 <模块>                 (M2 整体)
4. fix: <编号> QA 回归 + bug 修复         (跨 sprint 的 fix 汇总)
5. docs: <编号> 部署文档 + 验收报告        (第3e + 第8/9步)
```

## Commit message 格式（继承项目 CLAUDE.md §5.3）

```
<type>: <中文描述>
```

- 无 emoji、无 AI 署名（无 Co-Authored-By、无 🤖 Generated with）
- 中文描述用祈使语气："添加用户认证"，不是"添加了用户认证"
- 首行 ≤ 72 字符
- 多余说明放 body，与首行空一行
- 原子提交：一次 commit 只做一件事

### type 取值

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码风格（不影响逻辑） |
| `refactor` | 重构 |
| `perf` | 性能 |
| `test` | 测试 |
| `chore` | 构建/工具/依赖 |
| `ci` | CI/CD |
| `revert` | 回滚 |

### Hotfix 特殊格式

```
fix(<模块>): <简述> (BUG-<id>)
```

例：`fix(auth): 修复 JWT 刷新接口返回 401 (BUG-021)`

## 反模式（禁止）

| ❌ 反模式 | ✅ 正确做法 |
|----------|------------|
| 每轮 SA review 一个单独 commit | 合入对应里程碑 commit |
| README 进度同步单独 commit | 合入相邻业务 commit |
| 每个 Group 的 r1/r2/r3 各一个 commit | 全部 squash 进 sprint 里程碑 |
| "进度同步"/"状态更新"单独 commit | 合入业务 commit 或丢弃（progress.md 不进 commit） |
| commit message 带 emoji | 纯文本 |
| commit message 带 "🤖 Generated with Claude Code" | 删除 |

## 提交前检查（hooks/pre-commit 可选）

```bash
# 1. git status 范围核对
git status

# 2. git diff --cached 复查
git diff --cached

# 3. 多个独立改动 → 拆分提交
# 4. 不带 secrets（.env、credentials.json）
# 5. 不 --no-verify、不 --no-gpg-sign
```

## 操作命令

```bash
# 添加指定文件（避免 git add -A）
git add src/main/java/.../UserService.java
git add doc/01.feature/spec.md

# 提交（HEREDOC 保证格式）
git commit -m "$(cat <<'EOF'
feat: 01 M1 用户域 - 注册接口接入邮箱验证
EOF
)"

# Sprint 收尾 squash
git log --oneline main..HEAD          # 看本分支独有的 commit
git rebase -i main                     # 交互式 squash（不要 --no-edit）

# 推送
git push -u origin feature/01-feat-name
```

## 不能做的事

- 不 `git push --force` 到 master/main
- 不 `git reset --hard` 没确认
- 不 `git rebase --no-edit`
- 不 `git commit --amend` 已推送的 commit
- 不 `git config` 改全局/项目配置
- 不 `git add -A` 或 `git add .`（容易带 secrets）
- 不 `--no-verify`（hook 失败必须修因，不绕过）
- **不主动打 tag**。tag 仅用于生产发布，且由 CI/CD 自动打。任何 git 操作（squash / rebase / reset / 合并前等）都不打"备份 tag"或"里程碑 tag"——需要回退点用 `git reflog` 配合 `git reset --hard <hash>`（90 天内 HEAD 移动史可追溯）。

## Orchestrator 自动 squash 触发点

在 `progress.md` 状态转移到 `SPRINT_<N>_DONE` 时，orchestrator 检测：

- 本 sprint commit 数 > 1 → 提示用户跑 `git rebase -i main` 把 sprint 内 commit squash 为一个里程碑 commit
- 不**自动**执行 rebase（涉及历史改写，需用户确认）
- 不**强制**完成 squash（用户可选择跳过到下一 sprint），但合并 main 前 hooks/pre-merge-check.sh 会做最终把关
