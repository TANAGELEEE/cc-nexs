---
description: "用模板初始化新需求目录。自动按 all-docs/doc/ 下已有编号续号，自动从需求描述生成 slug。默认在 .worktrees/<id>-<slug>/ 创建独立 git worktree，多需求可并行。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Skill"
argument-hint: "<需求描述> [--mode=lean|hotfix|fast|full] [--risk-tier=auto|low|medium|high|critical] [--id=<编号>] [--slug=<短名>] [--repos=a,b] [--brainstorm]"
---

# /cc-nexs:init

一句话需求描述，自动续号 + 自动生成 slug + **建 worktree** + 拷模板 + 写入 mode。

参数：

- `$1` = 需求描述（必填，中英文都行）
- `--mode=lean|hotfix|fast|full` 流水线模式（新需求默认 `lean`）
  - `lean`：计划门禁、并行实现、本地验证、一次集中 Review、test 验收、发布门禁
  - `hotfix`：独立编号/feature 分支/latest-base worktree 的 mini-Lean；绝不复用旧需求分支或状态
  - `full`：五方异构（Planner/Tech Lead/SA/QA/Evaluator）
  - `fast`：三角色合并（Fullstack/Reviewer/Verifier），单 sprint，比 full 少 ~50% 调用
- `--id=<编号>` 强制使用指定编号（覆盖自动续号）
- `--risk-tier=auto|low|medium|high|critical` Feature 风险下限（默认 `auto`）。显式 high/critical 可让首次 Lean Planner 直接升级；自动值仍由计划或 Hotfix severity 判定。
- `--slug=<短名>` 强制使用指定 slug（覆盖自动生成）
- `--repos=a,b` 初始化时同时创建的代码仓库 worktree；docs repository 总是包含。未指定时先只建 docs，RECON/Planner 确认影响仓库后由 Custodian 扩展。
- `--brainstorm` 初始化完成后立即读取并遵循 brainstorming skill 文件，进入 Socratic 对话把一句话诉求展成完整 requirements.md（不传就只输出提示，不自动开启）
- 工作区模式始终由 Git Custodian 为 workspace 中命中的每个仓库建立独立 worktree；不提供会污染当前分支的 `--no-worktree` 降级。

## 执行步骤

### 1. 校验参数

```bash
DESC="$1"
if [ -z "$DESC" ]; then
  echo "❌ 用法：/cc-nexs:init <需求描述> [--mode=lean|hotfix|fast|full]"
  echo "   示例：/cc-nexs:init '添加 /api/health 健康检查接口'"
  echo "   示例：/cc-nexs:init '修支付偶现 500' --mode=fast"
  echo "   示例：/cc-nexs:init '用户注册接入邮箱验证' --id=14.2"
  exit 1
fi

# 解析 --mode 参数（默认 lean；项目 workflow.default_mode 可覆盖）
MODE=$(echo "$@" | grep -oE -- '--mode=[a-z]+' | cut -d= -f2)
[ -z "$MODE" ] && MODE="${CC_NEXS_DEFAULT_MODE:-lean}"
case "$MODE" in
  lean|hotfix|full|fast) ;;
  *)
    echo "❌ --mode 必须是 lean、hotfix、fast 或 full，当前值: $MODE"
    exit 1
    ;;
esac

# 解析 --brainstorm flag（opt-in；不传则保留旧行为）
BRAINSTORM=0
echo "$@" | grep -qE -- '(^| )--brainstorm( |$)' && BRAINSTORM=1

RISK_COUNT=$(echo "$@" | grep -oE -- '--risk-tier=[^ ]*' | wc -l | tr -d ' ')
[ "$RISK_COUNT" -gt 1 ] && { echo "❌ --risk-tier 只能出现一次"; exit 1; }
if echo "$@" | grep -qE -- '(^| )--risk-tier(=| |$)'; then
  RISK_ARG=$(echo "$@" | grep -oE -- '--risk-tier=[^ ]*')
  [ -n "$RISK_ARG" ] || { echo "❌ --risk-tier 必须使用 --risk-tier=<value>"; exit 1; }
  RISK_TIER=${RISK_ARG#*=}
  [ -n "$RISK_TIER" ] || { echo "❌ --risk-tier 不能为空"; exit 1; }
else
  RISK_TIER=auto
fi
case "$RISK_TIER" in
  auto|low|medium|high|critical) ;;
  *) echo "❌ --risk-tier 必须是 auto、low、medium、high 或 critical"; exit 1 ;;
esac

echo "🛠️  模式: ${MODE}"
[ "$BRAINSTORM" = "1" ] && echo "🧠 init 完成后将自动进入 brainstorming"
echo "🌲 Git Custodian 将按 workspace 配置建立多仓 worktree"
```

### 2. 决定编号

加载 workspace 后调用 core 的 `publishDocsReservation(workspace, { featureId, featureSlug, description })`。用户没有传 `--id` 时由该函数基于最新远端 docs base 自动分配；返回的 id 才是权威编号。

```bash
# 解析显式 --id 参数
ID=$(echo "$@" | grep -oE -- '--id=[^ ]+' | cut -d= -f2)

# SLUG 生成后再发布远端占号；返回值覆盖 ID
RESERVATION=$(publishDocsReservation(workspace, { featureId: ID || null, featureSlug: SLUG, description: DESC }))
ID=$RESERVATION.featureId

echo "📦 编号: ${ID}"
```

**续号规则**：
- fetch 配置的 docs repository 远端 base，扫描其 `doc/` 取最大数字 + 1
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

### 4. 发布远端占号（第一阶段 all-docs）

在建立任何代码 worktree 前，Git Custodian 使用 detached 临时 worktree，仅创建：

```text
doc/<id>.<slug>/README.md
doc/<id>.<slug>/.cc-nexs-reservation.json
```

然后提交并以普通 fast-forward push 写入 docs base。禁止 force push、禁止修改已有目录。自动编号遇到并发 push 冲突时必须 fetch 后换号重试；显式编号冲突直接失败。如果 master 受保护或无直推权限，init 在这里停止，不能继续创建本地-only 的需求。

### 4.5 由 Git Custodian 建立多仓 worktree

远端占号成功后，将 docs repository 与 `--repos` 合并去重，再调用 `createWorkspaceWorktrees(workspace, { featureId: ID, featureSlug: SLUG, repositoryIds })`。每个选中仓库先 fetch 最新 `origin/<base_branch>`，然后从该精确提交获得：

`<workspace>/.worktrees/<id>-<slug>/<repository-id>/`

docs worktree 此时已经包含第一阶段占号目录。分支统一为 `feature/<id>-<slug>`，base branch 严格取各仓库自己的 workspace 配置，且使用 `--no-track`，不得把 upstream 设成 base。主 checkout 当前即使停在 `test` 也不影响基线。创建任一仓失败时，Custodian 回滚本次已创建的 worktree 和分支，但保留已发布的远端占号，方便用同一 `--id` 重试。

把返回映射写入 progress.json 的 `repositories`，并将 `docs_repository` 对应 worktree 记为 `DOC_WORKTREE`。

### 5. 拷贝模板（在 WORK_DIR）

```bash
CC_NEXS_RESOLVED_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT:-}}}}"
[ -n "$CC_NEXS_RESOLVED_PLUGIN_ROOT" ] || { echo "❌ 找不到 plugin root（需 CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / CODEX_PLUGIN_ROOT / CC_NEXS_PLUGIN_ROOT）"; exit 1; }
REQ_DIR="${DOC_WORKTREE}/doc/${ID}.${SLUG}"
# Lean/hotfix 只复制各自最小文档和机器状态；fast/full 保持旧模板集合。
if [ "$MODE" = "lean" ] || [ "$MODE" = "hotfix" ]; then
  cp -r "${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates/${MODE}/"* "${REQ_DIR}/"
  rm -f "${REQ_DIR}/README.md"
else
  find "${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates" -mindepth 1 -maxdepth 1 ! -name lean ! -name hotfix -exec cp -R {} "${REQ_DIR}/" \;
fi
```

Lean 包含 requirements.md / plan.md；hotfix 只有 hotfix.md；两者另含 progress.json / progress.md / config.json。fast/full 保持原模板集合。

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

新模板必须保留 `config_version: 2` 与 `risk_tier`；Lean 模板默认 mode 是 `lean`，仍按最终 `MODE` 明确覆写：

```bash
CFG="${REQ_DIR}/config.json"
# 注意：BSD/macOS sed 不识别 \s，用 [[:space:]] 兼容
sed "${SED_INPLACE[@]}" -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"'"$MODE"'"/' "$CFG"
sed "${SED_INPLACE[@]}" -E 's/("risk_tier"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"'"$RISK_TIER"'"/' "$CFG"

# progress.json v2 是权威状态；progress.md 仅作为人类可读视图。
PROGRESS_JSON="${REQ_DIR}/progress.json"
sed "${SED_INPLACE[@]}" -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"'"$MODE"'"/' "$PROGRESS_JSON"
if [ "$MODE" = "full" ]; then
  sed "${SED_INPLACE[@]}" -E 's/("enabled"[[:space:]]*:[[:space:]]*)false/\1true/' "$PROGRESS_JSON"
fi
```

> 校验：`grep -E '"mode"[[:space:]]*:[[:space:]]*"'"$MODE"'"' "$CFG"` 应能匹配，否则报错回退。

### 7. 注入初始描述

让用户启动时已有 PM 给的"一句话诉求"作为基线，省得 PM 还要再敲一遍。

```bash
REQ_FILE="${REQ_DIR}/$([ "$MODE" = "hotfix" ] && echo hotfix.md || echo requirements.md)"
# 在第一行 # 标题后插入用户原始描述作为"业务诉求"摘要
# 具体插入位置由 Claude 按 requirements.md 模板结构判断
```

实际操作：Lean 注入 requirements.md；hotfix 注入 hotfix.md 的“现象”，并要求填写 severity/影响/范围字段后运行 `/cc-nexs:hotfix <id>`。

### 8. 记录仓库分配

禁止角色自行切分支。将 Custodian 返回的 repository id、branch 和 worktree 写入 progress.json，并追加 `workspace.worktrees_created` 事件。

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
   模式:    ${MODE}              ← lean | hotfix | fast | full
   目录:    ${REQ_DIR}/
   分支:    ${BRANCH}
   工作树:  ${WORK_DIR}           ← 走 worktree 时是 .worktrees/<id>-<slug>/
```

然后按 `BRAINSTORM` flag 走两条不同收尾：

**a) `BRAINSTORM=0`（默认）**——只输出提示，不自动激活，命令到此结束：

```
👉 下一步（任选其一）:
   可留在 workspace 根目录运行，Orchestrator 会按 progress.json 分派到各仓 worktree
   A. 自己手填 requirements.md；lean 运行 /cc-nexs:plan ${ID}，fast/full 运行 /cc-nexs:run ${ID}
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

随后**立刻读取并遵循 `brainstorming` skill 文件**（`packages/preset-standard/skills/brainstorming/SKILL.md`），按流程清单第 1 步开始；这是显式 `--brainstorm` 参数授权的内部流程加载，不依赖模型自动触发 skill：

- 读 `${REQ_DIR}/requirements.md`
- 读最近 git 提交作为上下文
- 一次一问开始 Socratic 对话

不要去调 `/cc-nexs:brainstorm` 这个 slash command——直接遵循 skill 文件里的流程清单即可（避免重复校验目录、重复加载 skill）。

用户终审通过后，按 skill 的"交棒话术"提示用户跑 `/cc-nexs:run ${ID}`，**不要**自动调 run。

## 用法示例

```bash
# 默认 lean 模式（自动续号 + 自动 slug）
/cc-nexs:init 添加 /api/health 健康检查接口
# → all-docs/doc/01.api-health-check/  mode=lean

# fast 模式：单接口小改动
/cc-nexs:init 修支付偶现 500 --mode=fast
# → all-docs/doc/02.payment-500-fix/  mode=fast

# fast 模式 + 强制 slug
/cc-nexs:init '修支付偶现 500' --mode=fast --slug=payment-500-fix
# → all-docs/doc/03.payment-500-fix/  mode=fast

# full 模式 + 带版本号（必须显式指定）
/cc-nexs:init 重做注册流程 --id=14.2 --mode=full
# → all-docs/doc/14.2.user-register-revamp/  mode=full

# 一条命令到位：init + 自动进入 brainstorming 对话
/cc-nexs:init "做个订单导出后台" --brainstorm
# → all-docs/doc/05.order-export-admin/  mode=lean
# → 立即进入 Socratic 对话补全 requirements.md

```

## 关于 worktree

init 会在 `<workspace>/.worktrees/<id>-<slug>/<repo-id>/` 为每个命中仓库建立独立 worktree。这样多个需求和多个仓库都能互不干扰。

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

- **禁止嵌套 init**：一个 feature worktree 集合对应一个需求。
- **角色只在 progress.json 分配的仓库 worktree 内工作**。
- **合并后安全清理**：仅 Git Custodian 在验证 worktree clean 且分支已合入配置 base 后删除 worktree、local branch 和 candidate ref。
- **无原地降级**：创建失败即回滚并停止，不污染调用者当前分支。

## 何时覆盖默认 lean

| 显式用 full | 显式用 fast |
|---|---|
| 跨模块、含 DB schema 变更 | 单模块单接口 |
| 涉及对外契约、合规风险 | 改动 ≤ 800 行 diff |
| Sprint 切片 ≥ 2 | 无并发/事务复杂度 |
| 需要严格五方异构纪律 | 接受 spec/code 同 session 的风险换效率 |

## 与原来的差异

之前：`/cc-nexs:init 01 health-check` （位置参数 + 必须人工想 slug）
现在：`/cc-nexs:init "添加 /api/health 健康检查接口" [--mode=lean|hotfix|fast|full]`（自动续号 + 自动 slug + mode 一次到位；默认 lean）

旧用法仍兼容：如果 `$1` 是纯数字格式（如 `01`、`14.2`）且 `$2` 是 kebab-case，按旧用法处理。
