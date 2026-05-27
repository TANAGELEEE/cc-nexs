---
name: using-worktrees
description: cc-nexs 创建新需求或恢复需求工作时确保自己处在隔离 git worktree 内，让多个需求可以并行开发互不干扰。流程：检测已有隔离 → git worktree 兜底创建 → 验证 .gitignore → 切目录与分支。触发词：worktree、并行需求、隔离工作目录、init 前准备、多需求并行、独立工作树。
---

# Using Git Worktrees（cc-nexs 版）

> cc-nexs 多需求并行开发的 worktree 管理 skill。三个核心约定：
>
> 1. **不使用 Claude Code 内置 EnterWorktree**——cc-nexs 要求 worktree 落在仓库的 `.worktrees/<id>-<slug>/`（项目根隐藏目录），与内置工具的 `.claude/worktrees/` 路径不一致。直接用 `git worktree add` 保证路径可控。
> 2. **嵌套 refuse**：cc-nexs 一个 worktree 对应一个需求，禁止在 worktree 内再 init 新需求。
> 3. **gitignore 自治**：skill 自动给宿主仓库加 `.worktrees/` 到 `.gitignore` 并 commit（仅当未 ignore 时）。

## 何时被调用

- `/cc-nexs:init` 默认调用本 skill 创建新 worktree（除非 `--no-worktree`）
- 用户主动说"开个 worktree 做"、"并行做这个需求"
- skill 不会被 `/cc-nexs:run` 调用——run 只做 sanity check（detect cwd 是否在期望 worktree 内）

## 输入

调用方传入两个必需值：

- `feature_id`（如 `01`、`14.2`）
- `feature_slug`（如 `api-health-check`）

派生：
- 期望 worktree 路径：`<repo-root>/.worktrees/<feature_id>-<feature_slug>/`
- 期望分支名：`feature/<feature_id>-<feature_slug>`

## 输出契约

执行结束后返回（在最后一行 echo 一段固定格式）：

```
WORKTREE_PATH=<absolute path>
BRANCH=feature/<id>-<slug>
STATUS=created | reused | refused_nested | failed_fallback_inplace
```

调用方（init.md）按 STATUS 分支：
- `created` / `reused` → 后续步骤在 worktree 内执行
- `refused_nested` → 调用方应 abort，提示用户回主仓库
- `failed_fallback_inplace` → 调用方退回 `git checkout -b` 旧路径

## Step 0：检测当前是否已在 worktree 或 submodule

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir 2>/dev/null)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
SUPERPROJECT=$(git rev-parse --show-superproject-working-tree 2>/dev/null)
```

判断：

- `[ -n "$SUPERPROJECT" ]` → 在 submodule，**当作普通仓库**继续（不是 worktree）
- `[ "$GIT_DIR" != "$GIT_COMMON" ]` 且非 submodule → **已在 linked worktree**

### 已在 worktree 的处理（cc-nexs 特化：refuse 嵌套）

```
❌ 当前已在 worktree（路径：<cwd>，分支：<branch>）
   cc-nexs 不允许在 worktree 内再 init 新需求。
   请先 cd 回主仓库再执行 /cc-nexs:init。
```

输出 `STATUS=refused_nested`，**直接返回**，不再走 Step 1+。

## Step 1：定位主仓库根

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_PATH="${REPO_ROOT}/.worktrees/${ID}-${SLUG}"
BRANCH="feature/${ID}-${SLUG}"
```

如果 `$WORKTREE_PATH` 已存在（比如用户重跑 init）：
- 检查它是否是有效 worktree（`git worktree list | grep -F "$WORKTREE_PATH"`）
- 是 → 报告 `STATUS=reused`，cd 进去，跳过创建
- 否 → 报错并提示用户手动清理（不主动 rm，避免丢工作）

## Step 2：保证 `.worktrees/` 在 .gitignore

```bash
cd "$REPO_ROOT"
if ! git check-ignore -q .worktrees 2>/dev/null; then
  # 未被 ignore，追加并 commit
  GITIGNORE="${REPO_ROOT}/.gitignore"
  if [ -f "$GITIGNORE" ] && grep -qE '^\.worktrees/?$' "$GITIGNORE"; then
    : # 已经写了但 git 还不识别（比如 .gitignore 本身没 commit）
  else
    printf '\n# cc-nexs worktrees（每个需求一个隔离工作树，不入主仓库）\n.worktrees/\n' >> "$GITIGNORE"
  fi
  git add .gitignore
  git commit -m "chore: ignore .worktrees/ for cc-nexs"
fi
```

> 边界：若 `.gitignore` 处于 staged 但未 commit 的中间状态，commit 会把用户其他改动一起带进来——所以 `git add` 只点名 `.gitignore`，不用 `-A`。

## Step 3：创建 worktree

```bash
git worktree add "$WORKTREE_PATH" -b "$BRANCH"
```

失败处理：

- 分支已存在：改用 `git worktree add "$WORKTREE_PATH" "$BRANCH"`（不带 `-b`，复用现有分支）
- 路径权限错误（sandbox 拒绝等）：输出 `STATUS=failed_fallback_inplace`，让调用方退回原地建分支
- 其他错误：把 git 原始报错抛出来，`STATUS=failed_fallback_inplace`

## Step 4：cd 进去并报告

```bash
cd "$WORKTREE_PATH"
```

最后输出：

```
✅ Worktree 已就绪
   路径: <绝对路径>
   分支: feature/<id>-<slug>
   宿主: <主仓库路径>

WORKTREE_PATH=<绝对路径>
BRANCH=feature/<id>-<slug>
STATUS=created
```

> 注意：Bash 工具的 cwd 状态不跨 tool call 持久化。所以"cd 进去"在单条 Bash 命令链里有效，多条命令必须在同一次 Bash 调用里串起来（用 `&&`），或者由调用方在每条命令前主动 `cd "$WORKTREE_PATH"`。init.md 处理这个细节。

## Quick Reference

| 情况 | 行为 |
|---|---|
| 已在 linked worktree（非 submodule） | refuse_nested，让用户回主仓库 |
| 在 submodule 内 | 当普通仓库继续 |
| `.worktrees/<id>-<slug>` 已存在且是有效 worktree | reused |
| `.worktrees/<id>-<slug>` 已存在但不是 worktree（孤儿目录） | 报错让用户手动清理 |
| `.worktrees/` 未被 gitignore | 自动追加并 commit |
| `git worktree add` 因权限失败 | failed_fallback_inplace |
| 分支已存在 | 复用（不加 `-b`） |

## 常见误区

### 别用 EnterWorktree

Claude Code 内置 `EnterWorktree` 工具会把 worktree 放到 `.claude/worktrees/`。cc-nexs 的产品决策是固定 `.worktrees/`（仓库根隐藏目录）让多机器多协作者路径一致，所以不用内置工具——这是路径稳定性优先于工具复用的有意取舍。

### 别在 worktree 里 init 新需求

cc-nexs 的语义是 1 个 worktree = 1 个需求。嵌套 init 会让分支命名、`.worktrees/` 检测、清理流程都混乱。Step 0 直接 refuse。

### 别忘了 .gitignore 必须 commit

只在工作区写 `.worktrees/` 不够——`git check-ignore` 用的是 staged + committed 状态。skill 里 `git add .gitignore && git commit` 是必须的。

### 别用 `git add -A`

宿主仓库可能有未 commit 的工作。skill 只 `git add .gitignore`，不要污染用户其他改动。

## 与 cc-nexs 流水线的契合

worktree 对状态机透明：

- `progress.md` 记录的 `current_state` 不变
- 各 agent 仍在 worktree 内的 `doc/<id>/` 下读写
- `/cc-nexs:run` 只在 Step -1 做 cwd 一致性检查（在主仓库直接 run 会被拒）
- COMPLETE 不自动清理——`/cc-nexs:run` 末尾打印手动清理指令

清理时机由用户决定（典型流程）：

1. worktree 内开发完，push 分支，发 PR
2. PR merge 进 main
3. 回主仓库 `cd <repo-root>`
4. `git worktree remove .worktrees/<id>-<slug>`
5. `git branch -d feature/<id>-<slug>`（已 merge 的本地分支）
