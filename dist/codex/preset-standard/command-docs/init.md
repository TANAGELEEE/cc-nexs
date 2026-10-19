---
description: "Initialize a new requirement directory from a template. Automatically continues numbering from existing numbers under all-docs/doc/, and automatically generates a slug from the requirement description. By default, creates an independent git worktree in .worktrees/<id>-<slug>/, so multiple requirements can run in parallel."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Skill"
argument-hint: "<requirement description> [--mode=lean|hotfix|fast|full] [--risk-tier=auto|low|medium|high|critical] [--id=<number>] [--slug=<short-name>] [--repos=a,b] [--brainstorm]"
---

# /cc-nexs:init

A one-line requirement description: automatically continue numbering + automatically generate a slug + **create a worktree** + copy the template + write the mode.

Parameters:

- `$1` = requirement description (required; Chinese or English both work)
- `--mode=lean|hotfix|fast|full` pipeline mode (new requirements default to `lean`)
  - `lean`: planning gate, parallel implementation, local verification, one consolidated Review, test acceptance, release gate
  - `hotfix`: directly create the fix branch and BUG document; does not consume a requirement number
  - `full`: five-party heterogeneous setup (Planner/Tech Lead/SA/QA/Evaluator)
  - `fast`: three roles consolidated (Fullstack/Reviewer/Verifier), single sprint, ~50% fewer calls than full
- `--id=<number>` force the specified number (overrides automatic numbering)
- `--risk-tier=auto|low|medium|high|critical` Feature risk floor (default `auto`). Explicitly setting high/critical lets the first Lean Planner escalate directly; automatic values are still determined by the plan or the Hotfix severity.
- `--slug=<short-name>` force the specified slug (overrides automatic generation)
- `--repos=a,b` code repository worktrees to also create at initialization; the docs repository is always included. When not specified, only docs is created first; after RECON/Planner confirms the affected repositories, the Custodian expands it.
- `--brainstorm` applies only to Lean/Fast/Full, and fills in requirements.md as needed; Hotfix directly fills in the BUG scope and does not enter requirements brainstorming
- Workspace mode always has the Git Custodian create an independent worktree for each repository matched in the workspace; there is no `--no-worktree` fallback that would pollute the current branch.

## Execution Steps

### 1. Validate parameters
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
[ "$BRAINSTORM" = "1" ] && [ "$MODE" != "hotfix" ] && echo "🧠 init 完成后将自动进入 brainstorming"
echo "🌲 Git Custodian 将按 workspace 配置建立多仓 worktree"
```
### 1.5 Hotfix Early Routing

If the final `MODE=hotfix`, generate or reuse `--slug` based on the description, then execute directly:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs init-hotfix <slug> --description "<原始描述>" [--repos a,b]
```
When you need to link an existing requirement or a custom BUG path, pass `--related`, `--bug-key`, and `--bug-file` directly to `/cc-nexs:hotfix`. `--id` is a requirement-number parameter and cannot be used to reserve a number for a Hotfix. Initialization and scope binding are handled by `/cc-nexs:hotfix <key-or-description>`; the subsequent numbering, placeholder commit, requirement template, or `--brainstorm` steps do not run.

The following steps apply only to Lean/Fast/Full.

### 2. Decide the number

After loading the workspace, call core's `publishDocsReservation(workspace, { featureId, featureSlug, description })`. If the user did not pass `--id`, this function assigns one automatically based on the latest remote docs base; the returned id is the authoritative number.
```bash
# 解析显式 --id 参数
ID=$(echo "$@" | grep -oE -- '--id=[^ ]+' | cut -d= -f2)

# SLUG 生成后再发布远端占号；返回值覆盖 ID
RESERVATION=$(publishDocsReservation(workspace, { featureId: ID || null, featureSlug: SLUG, description: DESC }))
ID=$RESERVATION.featureId

echo "📦 编号: ${ID}"
```
**Numbering rules**:
- Fetch the remote base of the configured docs repository, scan its `doc/` directory, and take the highest number + 1
- Do not fill gaps in non-consecutive numbering (if 01, 03, 05 exist → the next is 06, not 02)
- Zero-pad to two digits by default
- When the user passes `--id`, use the value the user gives (formats with a version or prefix such as `14.2` and `auth-001` are supported)

### 3. Determine the slug

If the user passed `--slug=<X>`, use it directly. Otherwise, **generate a kebab-case slug from the requirements description**:
```bash
SLUG=$(echo "$@" | grep -oE -- '--slug=[^ ]+' | cut -d= -f2)
```
If `$SLUG` is empty, **Claude itself** generates it according to the following rules (no brute-force shell conversion):

**slug generation rules (executed by Claude)**:

- Extract 2-4 core English words from the description
- All lowercase, kebab-case
- Chinese must be translated into English first, then compressed
- No project prefix (do not use `<project-prefix>-xxx`)
- No type prefix (do not use `feat-xxx` / `fix-xxx`)
- Keep numbers (e.g. `api-v2-migration`)
- Length ≤ 30 characters

**Examples**:

| Requirement description | Generated slug |
|---------|----------|
| Add /api/health health check endpoint | `api-health-check` |
| Add email verification to user registration | `user-register-email-verify` |
| Fix payment callback timeout issue | `payment-callback-timeout` |
| Add order export feature to admin panel | `admin-order-export` |
| Add JWT refresh endpoint | `jwt-refresh` |
| Refactor OrderService to split queries/writes | `order-service-cqrs-split` |

After generation, echo it to the user for confirmation:
```
🏷️  生成 slug: api-health-check
   （不满意可加 --slug=<你的> 重跑）
```
### 4. Publish remote seat reservations (Phase 1 all-docs)

Before creating any code worktree, Git Custodian uses a detached temporary worktree to create only:
```text
doc/<id>.<slug>/README.md
doc/<id>.<slug>/.cc-nexs-reservation.json
```
Then commit and write to the docs base with a normal fast-forward push. Force pushes are forbidden, and modifying existing directories is forbidden. When automatic numbering encounters a concurrent push conflict, it must fetch and then retry with a new number; an explicit numbering conflict fails immediately. If master is protected or there is no direct-push permission, init stops here and must not continue to create a local-only requirement.

### 4.5 Creating Multi-Repo Worktrees via the Git Custodian

After the remote number reservation succeeds, merge the docs repository with `--repos` and deduplicate, then call `createWorkspaceWorktrees(workspace, { featureId: ID, featureSlug: SLUG, repositoryIds })`. For each selected repository, first fetch the latest `origin/<base_branch>`, then create from that exact commit:

`<workspace>/.worktrees/<id>-<slug>/<repository-id>/`

At this point the docs worktree already contains the number-reservation directory from the first phase. Branches are uniformly named `feature/<id>-<slug>`, the base branch is taken strictly from each repository's own workspace configuration, and `--no-track` is used; upstream must not be set to the base. Even if the main checkout currently sits on `test`, the baseline is unaffected. If creating any repository fails, the Custodian rolls back the worktrees and branches created in this run, but retains the published remote number reservation so the same `--id` can be used to retry.

Write the returned mapping into `repositories` in progress.json, and record the worktree corresponding to `docs_repository` as `DOC_WORKTREE`.

### 5. Copy Templates (in WORK_DIR)
```bash
CC_NEXS_RESOLVED_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT:-}}}}"
[ -n "$CC_NEXS_RESOLVED_PLUGIN_ROOT" ] || { echo "❌ 找不到 plugin root（需 CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / CODEX_PLUGIN_ROOT / CC_NEXS_PLUGIN_ROOT）"; exit 1; }
REQ_DIR="${DOC_WORKTREE}/doc/${ID}.${SLUG}"
# Optional locale-specific template overlays fall back to the preset's default templates. The default path remains `${PLUGIN_ROOT}/templates/${MODE}/`.
TEMPLATE_ROOT="${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates"
CC_NEXS_LOCALE="${CC_NEXS_LOCALE:-en-US}"
LOCALE_TEMPLATE_ROOT=""
if [ -n "${CC_NEXS_LOCALE:-}" ] && [ -d "${TEMPLATE_ROOT}/${CC_NEXS_LOCALE}" ]; then LOCALE_TEMPLATE_ROOT="${TEMPLATE_ROOT}/${CC_NEXS_LOCALE}"; fi
# Lean copies the smallest document set; Fast/Full keep the existing complete template set.
if [ "$MODE" = "lean" ]; then
  cp -r "${TEMPLATE_ROOT}/${MODE}/"* "${REQ_DIR}/"
  [ -d "${LOCALE_TEMPLATE_ROOT}/${MODE}" ] && cp -r "${LOCALE_TEMPLATE_ROOT}/${MODE}/"* "${REQ_DIR}/"
  rm -f "${REQ_DIR}/README.md"
else
  find "${TEMPLATE_ROOT}" -mindepth 1 -maxdepth 1 ! -name lean ! -name hotfix ! -name en-US ! -name zh-TW -exec cp -R {} "${REQ_DIR}/" \;
  if [ -d "$LOCALE_TEMPLATE_ROOT" ]; then find "$LOCALE_TEMPLATE_ROOT" -mindepth 1 -maxdepth 1 ! -name lean ! -name hotfix ! -name en-US ! -name zh-TW -exec cp -R {} "${REQ_DIR}/" \; fi
fi
```
Lean 包含 requirements.md、plan.md 以及 progress.json、progress.md、config.json。Fast 和 Full 保留原有模板集合。Hotfix 已在步骤 1.5 中使用独立的 BUG 文档和本地机器状态。

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
### 6.5 Writing mode to config.json

The new template must retain `config_version: 2` and `risk_tier`; the Lean template's default mode is `lean`, but the final `MODE` still overrides it explicitly:
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
> Validation: `grep -E '"mode"[[:space:]]*:[[:space:]]*"'"$MODE"'"' "$CFG"` should match; otherwise it errors out and falls back.

### 7. Inject the Initial Description

So that the user already has the PM's "one-sentence request" as a baseline at startup, sparing the PM from having to type it out again.
```bash
REQ_FILE="${REQ_DIR}/requirements.md"
# 在第一行 # 标题后插入用户原始描述作为"业务诉求"摘要
# 具体插入位置由 Claude 按 requirements.md 模板结构判断
```
Inject the raw description into requirements.md. The initial symptoms of the Hotfix are written to the BUG document by `init-hotfix`.

### 8. Record the repository assignment

Roles must not switch branches on their own. Write the repository id, branch, and worktree returned by the Custodian into progress.json, and append a `workspace.worktrees_created` event.

### 9. Update the initial state in progress.md

In progress.md:
- `current_state: INIT`
- `updated_at: <now ISO8601>`
- Append one line to the history trace: `- <ts> (init) → INIT  /cc-nexs:init "<DESC>"`

### 10. Output confirmation + decide on wrap-up

First output the fixed header:
```
✅ 需求目录已初始化
   编号:    ${ID}
   短名:    ${SLUG}
   描述:    ${DESC}
   模式:    ${MODE}              ← lean | fast | full
   目录:    ${REQ_DIR}/
   分支:    ${BRANCH}
   工作树:  ${WORK_DIR}           ← 走 worktree 时是 .worktrees/<id>-<slug>/
```
Then, depending on the `BRAINSTORM` flag, there are two different endings:

**a) `BRAINSTORM=0` (default)** — only output the prompt, do not activate automatically, and the command ends here:
```
👉 下一步（任选其一）:
   可留在 workspace 根目录运行，Orchestrator 会按 progress.json 分派到各仓 worktree
   A. 自己手填 requirements.md；lean 运行 /cc-nexs:plan ${ID}，fast/full 运行 /cc-nexs:run ${ID}
   B. /cc-nexs:brainstorm ${ID}
      补全 requirements.md 中影响范围或验收的关键缺口，
      然后 lean 进入 /cc-nexs:plan ${ID}，fast/full 进入 /cc-nexs:run ${ID}
   提示：下次可直接 /cc-nexs:init "<描述>" --brainstorm 一条命令到位
```
**b) `BRAINSTORM=1` (matches `--brainstorm`)**——Skip "pick one" and go straight into the conversation:
```
🧠 init 完成，进入 brainstorming
   本阶段只更新 requirements.md；审批由当前模式的正式门禁承接
```
Then **immediately read and follow the `brainstorming` skill file** (`packages/preset-standard/skills/brainstorming/SKILL.md`) to flesh out the current requirement; this is an internal process load authorized by the explicit `--brainstorm` argument, and does not rely on the model auto-triggering the skill:

- Read `${REQ_DIR}/requirements.md`
- Load only project materials related to the key gaps
- Clarify questions that cannot be determined from the current state and that affect scope, acceptance, or authorization

Do not call the `/cc-nexs:brainstorm` slash command—just follow the process checklist in the skill file (this avoids re-validating the directory and re-loading the skill).

After brainstorming is complete, Lean enters `/cc-nexs:plan ${ID}`, and Fast/Full enter `/cc-nexs:run ${ID}`. If authorization to continue already exists and there are no key gaps, continue; do not turn brainstorming into an additional approval point.

## Usage example
```bash
# 默认 lean 模式（自动续号 + 自动 slug）
/cc-nexs:init 添加 /api/health 健康检查接口
# → all-docs/doc/01.api-health-check/  mode=lean

# fast 模式：单 Sprint 小改动，也可包含独立仓库的前后端并行实现
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
## About worktrees

init creates a separate worktree for each matched repository at `<workspace>/.worktrees/<id>-<slug>/<repo-id>/`. This keeps multiple requirements and multiple repositories from interfering with each other.
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
Constraints:

- **No nested init**: one feature worktree set corresponds to one requirement.
- **Roles work only inside the repository worktree assigned by progress.json**.
- **Safe cleanup after merge**: only the Git Custodian deletes the worktree, local branch, and candidate ref after verifying that the worktree is clean and the branch has been merged into the configured base.
- **No in-place degradation**: if creation fails, roll back and stop; do not pollute the caller's current branch.

## When to override the default lean

| Explicitly use full | Explicitly use fast |
|---|---|
| Multiple Sprints, includes DB schema changes | Single Sprint, changes ≤ 800 lines of diff |
| Breaking external contracts, compliance risk | May include contract freeze, frontend/backend parallelism across different repositories |
| Sprint slices ≥ 2 | No concurrency/transaction complexity |
| Requires strict five-party heterogeneous discipline | Accepts the risk of spec/code in the same session in exchange for efficiency |

## Differences from the original

Before: `/cc-nexs:init 01 health-check` (positional arguments + must manually come up with a slug)
Now: `/cc-nexs:init "添加 /api/health 健康检查接口" [--mode=lean|hotfix|fast|full]` (automatic number continuation + automatic slug + mode in one step; defaults to lean)

Old usage remains compatible: if `$1` is in pure numeric format (such as `01`, `14.2`) and `$2` is kebab-case, handle it as the old usage.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
