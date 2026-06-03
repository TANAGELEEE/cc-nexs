---
description: 用模板初始化新需求目录。自动按 all-docs/doc/ 下已有编号续号，自动从需求描述生成 slug。默认在 .worktrees/<id>-<slug>/ 创建独立 git worktree，多需求可并行。
allowed-tools: Read, Write, Edit, Bash, Glob, Skill
argument-hint: <需求描述> [--mode=full|fast] [--id=<编号>] [--slug=<短名>] [--brainstorm] [--no-worktree]
---

# /cc-nexs:init

一句话需求描述，自动续号 + 自动生成 slug + **建 worktree** + 拷模板 + 写入 mode。

参数：

- `$1` = 需求描述（必填，中英文都行）
- `--mode=full|fast` 流水线模式（默认 `full`）
  - `full`：五方异构（Planner/Tech Lead/SA/QA/Evaluator）
  - `fast`：三角色合并（Fullstack/Reviewer/Verifier），单 sprint，比 full 少 ~50% 调用
- `--id=<编号>` 强制使用指定编号（覆盖自动续号）
- `--slug=<短名>` 强制使用指定 slug（覆盖自动生成）
- `--brainstorm` 初始化完成后立即激活 brainstorming skill，进入 Socratic 对话把一句话诉求展成完整 requirements.md（不传就只输出提示，不自动开启）
- `--no-worktree` 关闭 worktree，沿用旧行为（`git checkout -b` 在当前目录切分支）。默认建 worktree。

## 执行步骤

### 1. 校验参数

```bash
DESC="$1"
if [ -z "$DESC" ]; then
  echo "❌ 用法：/cc-nexs:init <需求描述> [--mode=full|fast]"
  echo "   示例：/cc-nexs:init '添加 /api/health 健康检查接口'"
  echo "   示例：/cc-nexs:init '修支付偶现 500' --mode=fast"
  echo "   示例：/cc-nexs:init '用户注册接入邮箱验证' --id=14.2"
  exit 1
fi

# 解析 --mode 参数（默认 full）
MODE=$(echo "$@" | grep -oE -- '--mode=[a-z]+' | cut -d= -f2)
[ -z "$MODE" ] && MODE=full
case "$MODE" in
  full|fast) ;;
  *)
    echo "❌ --mode 必须是 full 或 fast，当前值: $MODE"
    exit 1
    ;;
esac

# 解析 --brainstorm flag（opt-in；不传则保留旧行为）
BRAINSTORM=0
echo "$@" | grep -qE -- '(^| )--brainstorm( |$)' && BRAINSTORM=1

# 解析 --no-worktree flag（默认建 worktree）
USE_WORKTREE=1
echo "$@" | grep -qE -- '(^| )--no-worktree( |$)' && USE_WORKTREE=0

echo "🛠️  模式: ${MODE}"
[ "$BRAINSTORM" = "1" ] && echo "🧠 init 完成后将自动进入 brainstorming"
[ "$USE_WORKTREE" = "1" ] && echo "🌲 将建立 worktree（.worktrees/<id>-<slug>/，可并行多需求）" \
                         || echo "📍 --no-worktree：在当前目录直接切分支"
```

### 2. 决定编号

如果用户传了 `--id=<X>`，直接用。否则扫描 `all-docs/doc/` 下已有目录续号：

```bash
# 解析显式 --id 参数
ID=$(echo "$@" | grep -oE -- '--id=[^ ]+' | cut -d= -f2)

if [ -z "$ID" ]; then
  # 自动续号：扫 all-docs/doc/<数字>.<slug>/ 形式
  if [ -d all-docs/doc ]; then
    LAST=$(ls -d all-docs/doc/*/ 2>/dev/null \
      | grep -oE 'all-docs/doc/[0-9]+\.' \
      | grep -oE '[0-9]+' \
      | sort -n \
      | tail -1)
  else
    LAST=""
  fi

  if [ -z "$LAST" ]; then
    ID="01"
  else
    # 注意 BSD/macOS 兼容：用 10# 强制十进制（避免 09 被当八进制）
    NEXT=$((10#$LAST + 1))
    ID=$(printf "%02d" $NEXT)
  fi
fi

echo "📦 编号: ${ID}"
```

**续号规则**：
- 扫 `all-docs/doc/<数字>.<任意>/` 取最大数字 + 1
- 不连续编号不补缺（已有 01、03、05 → 下一个是 06，不是 02）
- 默认两位零填充
- 用户带 `--id` 时按用户给的（支持 `14.2`、`auth-001` 这种带版本/前缀的格式）

### 3. 决定 slug

如果用户传了 `--slug=<X>`，直用。否则**根据需求描述生成 kebab-case slug**：

```bash
SLUG=$(echo "$@" | grep -oE -- '--slug=[^ ]+' | cut -d= -f2)
```

如果 `$SLUG` 为空，按以下规则**由 Claude 自己**生成（不用 shell 暴力转换）：

**slug 生成规则（Claude 执行）**：

- 提炼描述里的 2-4 个核心英文词
- 全部小写、kebab-case
- 中文需先翻译成英文再压缩
- 不带项目前缀（不要 `<project-prefix>-xxx`）
- 不带类型前缀（不要 `feat-xxx` / `fix-xxx`）
- 数字保留（如 `api-v2-migration`）
- 长度 ≤ 30 字符

**例子**：

| 需求描述 | 生成 slug |
|---------|----------|
| 添加 /api/health 健康检查接口 | `api-health-check` |
| 用户注册接入邮箱验证 | `user-register-email-verify` |
| 修复支付回调超时问题 | `payment-callback-timeout` |
| 后台管理新增订单导出功能 | `admin-order-export` |
| Add JWT refresh endpoint | `jwt-refresh` |
| 重构 OrderService 拆分查询/写入 | `order-service-cqrs-split` |

生成后 echo 给用户确认：

```
🏷️  生成 slug: api-health-check
   （不满意可加 --slug=<你的> 重跑）
```

### 4. 检查目录冲突（在主仓库）

无论是否走 worktree，都先在**主仓库**预检 all-docs/doc/<id>.<slug>/ 是否已存在——避免建完 worktree 才发现冲突。

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
REQ_REL="all-docs/doc/${ID}.${SLUG}"
REQ_PRE="${REPO_ROOT}/${REQ_REL}"

if [ -d "$REQ_PRE" ]; then
  echo "❌ 目录已存在: ${REQ_REL}"
  if [ -f "${REQ_PRE}/progress.md" ]; then
    STATE=$(grep '^current_state:' "${REQ_PRE}/progress.md" | head -1 | awk '{print $2}')
    echo "📊 当前状态: ${STATE}"
    echo "👉 继续推进:  /cc-nexs:run ${ID}"
    echo "👉 看完整状态: /cc-nexs:status ${ID}"
  fi
  exit 1
fi
```

### 4.5 建 worktree（默认行为）

**仅当 `USE_WORKTREE=1` 时执行**。调用 `using-worktrees` skill：

```
Skill(skill="using-worktrees", args="<ID> <SLUG>")
```

skill 负责：
- 检测当前是否已在 worktree（是 → refuse 嵌套，要求用户回主仓库）
- 主仓库的 `.gitignore` 加 `.worktrees/`（若未 ignore）
- `git worktree add .worktrees/<id>-<slug> -b feature/<id>-<slug>`
- 输出 `WORKTREE_PATH=...` `BRANCH=...` `STATUS=...`

读取 skill 输出并设置后续工作目录：

```bash
# 由 skill 输出解析得到（Claude 直接读 skill 报告）
# WORKTREE_PATH=<绝对路径>
# STATUS=created | reused | refused_nested | failed_fallback_inplace

case "$STATUS" in
  created|reused)
    WORK_DIR="$WORKTREE_PATH"
    BRANCH_CREATED=1   # skill 已创建分支，Step 8 跳过
    ;;
  refused_nested)
    echo "↩️  请 cd 回主仓库再 init"
    exit 1
    ;;
  failed_fallback_inplace)
    echo "⚠️  worktree 创建失败，退回原地建分支"
    WORK_DIR="$REPO_ROOT"
    BRANCH_CREATED=0
    ;;
esac
```

**`USE_WORKTREE=0`**（`--no-worktree`）时：

```bash
WORK_DIR="$REPO_ROOT"
BRANCH_CREATED=0
```

> 关键：后续步骤 5–9 都在 `$WORK_DIR` 下执行。Bash 工具的 cwd 不跨调用持久化，所以每条 Bash 命令前用 `cd "$WORK_DIR" && ...` 或者全部用绝对路径 `${WORK_DIR}/...`。

### 5. 拷贝模板（在 WORK_DIR）

```bash
CC_NEXS_RESOLVED_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT:-}}}}"
[ -n "$CC_NEXS_RESOLVED_PLUGIN_ROOT" ] || { echo "❌ 找不到 plugin root（需 CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / CODEX_PLUGIN_ROOT / CC_NEXS_PLUGIN_ROOT）"; exit 1; }
REQ_DIR="${WORK_DIR}/${REQ_REL}"
mkdir -p "$REQ_DIR"
cp -r "${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates/"* "${REQ_DIR}/"
```

包含模板：requirements.md / spec.md / dev-plan.md / test-cases.md / api-doc.md / deploy.md / acceptance.md / test-report.md / progress.md / config.json / bugs/BUG-template.md

### 6. 占位符替换

```bash
# macOS/BSD vs Linux/GNU sed 兼容
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=("-i")
else
  SED_INPLACE=("-i" "")
fi

find "$REQ_DIR" -type f \( -name "*.md" -o -name "*.json" \) | while read f; do
  sed "${SED_INPLACE[@]}" -e "s/{编号}/${ID}/g" -e "s/{需求短名}/${SLUG}/g" "$f"
done
```

### 6.5 写入 mode 到 config.json

模板里 `mode` 默认值是 `full`，按 `--mode` 参数覆写：

```bash
CFG="${REQ_DIR}/config.json"
# 仅当 MODE != full 时才改（默认值已经是 full）
# 注意：BSD/macOS sed 不识别 \s，用 [[:space:]] 兼容
if [ "$MODE" != "full" ]; then
  sed "${SED_INPLACE[@]}" -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"'"$MODE"'"/' "$CFG"
fi
```

> 校验：`grep -E '"mode"[[:space:]]*:[[:space:]]*"'"$MODE"'"' "$CFG"` 应能匹配，否则报错回退。

### 7. 把需求描述写入 requirements.md 头部

让用户启动时已有 PM 给的"一句话诉求"作为基线，省得 PM 还要再敲一遍。

```bash
REQ_FILE="${REQ_DIR}/requirements.md"
# 在第一行 # 标题后插入用户原始描述作为"业务诉求"摘要
# 具体插入位置由 Claude 按 requirements.md 模板结构判断
```

实际操作：用 Edit 工具把 `${DESC}` 注入到 requirements.md 的"业务诉求"或"一句话诉求"段落，**保留模板的其他章节让人工继续填**。

### 8. 切到 feature 分支（仅 `--no-worktree` 模式）

走 worktree 时 skill 已经在 worktree 里建好分支（`BRANCH_CREATED=1`），跳过本步。

```bash
BRANCH="feature/${ID}-${SLUG}"

if [ "$BRANCH_CREATED" != "1" ]; then
  CURRENT=$(git -C "$WORK_DIR" branch --show-current)
  # 始终从最新远端主分支拉取
  DEFAULT_BRANCH=$(git -C "$WORK_DIR" remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
  [ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="master"
  git -C "$WORK_DIR" fetch origin "$DEFAULT_BRANCH" --quiet 2>/dev/null || true
  case "$CURRENT" in
    master|main|test)
      git -C "$WORK_DIR" checkout -b "$BRANCH" "origin/$DEFAULT_BRANCH"
      ;;
    "$BRANCH")
      echo "已在 ${BRANCH} 分支，无需切换"
      ;;
    *)
      echo "⚠️ 当前分支 ${CURRENT}，未自动切换"
      echo "   建议手动: git -C ${WORK_DIR} checkout -b ${BRANCH} origin/${DEFAULT_BRANCH}"
      ;;
  esac
fi
```

### 9. 更新 progress.md 初始状态

把 progress.md 里：
- `current_state: INIT`
- `updated_at: <now ISO8601>`
- 历史轨迹 append 一行：`- <ts> (init) → INIT  /cc-nexs:init "<DESC>"`

### 10. 输出确认 + 决定收尾

先输出固定头部：

```
✅ 需求目录已初始化
   编号:    ${ID}
   短名:    ${SLUG}
   描述:    ${DESC}
   模式:    ${MODE}              ← full | fast
   目录:    ${REQ_DIR}/
   分支:    ${BRANCH}
   工作树:  ${WORK_DIR}           ← 走 worktree 时是 .worktrees/<id>-<slug>/
```

然后按 `BRAINSTORM` flag 走两条不同收尾：

**a) `BRAINSTORM=0`（默认）**——只输出提示，不自动激活，命令到此结束：

```
👉 下一步（任选其一）:
   先 cd 到工作树：cd ${WORK_DIR}     ← 仅 worktree 模式需要；--no-worktree 跳过
   A. 自己手填 requirements.md，再 /cc-nexs:run ${ID}
   B. /cc-nexs:brainstorm ${ID}
      让 Claude 用 Socratic 对话把一句话诉求展成完整 requirements.md，
      然后再 /cc-nexs:run ${ID}（推荐：需求模糊 / 想压一压思路时）
   提示：下次可直接 /cc-nexs:init "<描述>" --brainstorm 一条命令到位
```

**b) `BRAINSTORM=1`（命中 `--brainstorm`）**——跳过"任选其一"，直接进入对话：

```
🧠 init 完成，进入 brainstorming
   HARD-GATE：禁写 spec/code，仅写 requirements.md
```

随后**立刻激活 `brainstorming` skill**（`packages/preset-nexs/skills/brainstorming/SKILL.md`），按 skill 流程清单第 1 步开始：

- 读 `${REQ_DIR}/requirements.md`
- 读最近 git 提交作为上下文
- 一次一问开始 Socratic 对话

不要去调 `/cc-nexs:brainstorm` 这个 slash command——直接遵循 skill 文件里的流程清单即可（避免重复校验目录、重复加载 skill）。

用户终审通过后，按 skill 的"交棒话术"提示用户跑 `/cc-nexs:run ${ID}`，**不要**自动调 run。

## 用法示例

```bash
# 默认 full 模式（自动续号 + 自动 slug）
/cc-nexs:init 添加 /api/health 健康检查接口
# → all-docs/doc/01.api-health-check/  mode=full

# fast 模式：单接口小改动
/cc-nexs:init 修支付偶现 500 --mode=fast
# → all-docs/doc/02.payment-500-fix/  mode=fast

# fast 模式 + 强制 slug
/cc-nexs:init '修支付偶现 500' --mode=fast --slug=payment-500-fix
# → all-docs/doc/03.payment-500-fix/  mode=fast

# full 模式 + 带版本号
/cc-nexs:init 重做注册流程 --id=14.2
# → all-docs/doc/14.2.user-register-revamp/  mode=full

# 一条命令到位：init + 自动进入 brainstorming 对话
/cc-nexs:init "做个订单导出后台" --brainstorm
# → all-docs/doc/05.order-export-admin/  mode=full
# → 立即进入 Socratic 对话补全 requirements.md

# 关 worktree（旧行为）：直接在当前目录切分支
/cc-nexs:init "微调首页文案" --no-worktree
# → all-docs/doc/06.homepage-copy-tweak/  mode=full
# → git checkout -b feature/06-homepage-copy-tweak（在当前目录）
```

## 关于 worktree

默认行为：init 会在 `<repo>/.worktrees/<id>-<slug>/` 建独立 git worktree，给该需求一个隔离的工作目录。这样你可以同时开多个需求互不打扰：

```
# 主仓库目录
$ cd ~/projects/myrepo
$ /cc-nexs:init "需求 A"
✅ 已建 .worktrees/01-feat-a/ + feature/01-feat-a 分支
$ cd .worktrees/01-feat-a && /cc-nexs:run 01    # 在 worktree 里推进 A

# 同时另开一个需求
$ cd ~/projects/myrepo                          # 回主仓库
$ /cc-nexs:init "需求 B"
✅ 已建 .worktrees/02-feat-b/ + feature/02-feat-b 分支
$ cd .worktrees/02-feat-b && /cc-nexs:run 02    # B 跟 A 完全独立
```

约束：

- **禁止在 worktree 内嵌套 init**：cc-nexs 一个 worktree 对应一个需求。在 worktree 内再跑 init 会被 skill 拒绝，需要 cd 回主仓库。
- **`/cc-nexs:run` 必须在对应 worktree 内运行**：在主仓库直接跑 `run` 会被拒绝并提示 cd。
- **不自动清理**：merge 完成后，自己回主仓库执行 `git worktree remove .worktrees/<id>-<slug> && git branch -d feature/<id>-<slug>`。
- **`--no-worktree`**：保留旧行为（在当前目录 `git checkout -b`）。适合不想要 worktree 隔离的用户、或宿主目录权限受限的场景。

## 何时选 fast

| 用 full（默认） | 用 fast |
|---|---|
| 跨模块、含 DB schema 变更 | 单模块单接口 |
| 涉及对外契约、合规风险 | 改动 ≤ 800 行 diff |
| Sprint 切片 ≥ 2 | 无并发/事务复杂度 |
| 需要严格五方异构纪律 | 接受 spec/code 同 session 的风险换效率 |

## 与原来的差异

之前：`/cc-nexs:init 01 health-check` （位置参数 + 必须人工想 slug）
现在：`/cc-nexs:init "添加 /api/health 健康检查接口" [--mode=fast]`（自动续号 + 自动 slug + mode 一次到位）

旧用法仍兼容：如果 `$1` 是纯数字格式（如 `01`、`14.2`）且 `$2` 是 kebab-case，按旧用法处理。
