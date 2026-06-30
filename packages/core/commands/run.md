---
description: Generic orchestrator. Reads progress.md state, dispatches to enabled roles per preset.yml, runs the state machine until COMPLETE or human gate.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Task
argument-hint: [feature_id] [--sprint=N | --resume]
---

# /cc-nexs:run

> **Core rule**: after a stage completes, immediately enter the next stage. Do NOT print a summary and wait for user input. **The exceptions** are human gates (`SPEC_PENDING_HUMAN` and `*_DEPLOY_GATE`) — in those cases stop and return.

This command is the generic orchestrator. It loads `cc-nexs.config.yml` + the active `preset.yml`, then drives the state machine in `@cc-nexs/core/lib/state-machine.mjs`.

## Orchestrator Identity & Anti-overreach

> **身份声明**：Orchestrator 只编排，**不写文件、不提交任何仓库、不写代码、不写 spec、不评审、不测试**。

### 交付物验证协议

成员角色声称"已完成"时，Orchestrator **必须**通过 `git fetch && git ls-tree` 验证产出物确实存在于远端分支，**禁止盲信声明**：

```bash
git fetch origin <branch>
git ls-tree origin/<branch> <expected_artifact_path>
```

- 文件可见 → 确认完成，推进状态机
- 文件不可见 → **重新 dispatch 给原角色**，附带明确补推指令

### 禁止自行补救

发现成员交付物缺失（文档未推送 / 任务未完成）时：
- ❌ 禁止 Orchestrator 自己补写、补推、补提交
- ✅ 必须重新派发给对应成员，附带"你的 XX 文档未推送到 <branch>，请补推"

### 并行 dispatch 规则

当 `nextStep()` 返回 `parallel` 字段时，Orchestrator **必须**使用 Agent tool 并发调用两个角色（在同一条消息中发出多个 Agent tool call），而非串行执行：

```
// nextStep 返回示例:
{ next: 'SPRINT_1_DEV', role: 'tech-lead', action: 'implement', parallel: { role: 'qa', action: 'write_cases' } }

// → 同时 dispatch:
//   Agent 1: tech-lead → implement
//   Agent 2: qa → write_cases
// 两者完成后再推进状态机
```

## Step -1: Worktree sanity check

cc-nexs `init` defaults to creating an isolated worktree at `<repo>/.worktrees/<id>-<slug>/`. `run` must be executed **inside that worktree**, otherwise state writes (progress.md, all-docs/doc/*.md) land on the wrong branch.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(cd "$(git rev-parse --git-dir 2>/dev/null)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
SUPERPROJECT=$(git rev-parse --show-superproject-working-tree 2>/dev/null)

# Treat submodule as plain repo (not a worktree).
if [ -z "$SUPERPROJECT" ] && [ "$GIT_DIR" != "$GIT_COMMON" ]; then
  IN_WORKTREE=1
else
  IN_WORKTREE=0
fi

# If a matching .worktrees/<id>-* exists in the main repo, the feature was init'd with worktree
# mode; the user MUST run from inside it.
if [ -n "$1" ]; then
  EXPECTED=$(ls -d "$REPO_ROOT"/.worktrees/${1}-*/ 2>/dev/null | head -1)
else
  EXPECTED=$(ls -d "$REPO_ROOT"/.worktrees/*/ 2>/dev/null | head -1)
fi

if [ -n "$EXPECTED" ] && [ "$IN_WORKTREE" != "1" ]; then
  echo "❌ /cc-nexs:run must be executed inside the feature worktree."
  echo "   Expected: ${EXPECTED}"
  echo "   Try:      cd ${EXPECTED} && /cc-nexs:run $1"
  exit 1
fi

# When EXPECTED is empty, the feature was likely init'd with --no-worktree; carry on as before.
```

## Step 0: Locate active feature

```bash
if [ -n "$1" ]; then
  REQ_DIR=$(ls -d all-docs/doc/${1}*/ 2>/dev/null | head -1)
else
  REQ_DIR=$(ls -d all-docs/doc/*/ 2>/dev/null | grep -v _templates | head -1)
fi
[ -z "$REQ_DIR" ] && { echo "No feature directory found under all-docs/doc/"; exit 1; }
PROGRESS="${REQ_DIR}progress.md"
```

If `progress.md` does not exist, copy from preset `templates/progress.md` and set `current_state: INIT`.

### Step 0.1: README catch-up sync (defensive)

Every run invocation starts by syncing README to match current progress.md — this covers cases where the previous run was interrupted, manually driven, or crashed mid-step:

```js
import { syncFeatureReadme } from '@cc-nexs/core/lib/readme-sync.mjs';
try { syncFeatureReadme({ reqDir: REQ_DIR }); } catch (_) { /* best-effort */ }
```

This is idempotent: if README is already current, it returns `no_change` and costs nothing.

## Step 0.5: Resolve feature mode

Read `${REQ_DIR}config.json` and extract `mode` (defaults to `full` if missing or unknown):

```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" 2>/dev/null \
  | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ -z "$MODE" ] && MODE=full
case "$MODE" in
  full|fast|lite|hotfix) ;;
  *) echo "⚠ unknown mode '$MODE', falling back to full"; MODE=full ;;
esac
```

The mode controls two things downstream:
1. Which `enabled` role list and state-machine flavor `nextStep` uses (`mode=fast` switches to the merged 3-role pipeline).
2. Which slash command name maps to each role in the dispatch table (Step 2).

## Step 1: Load config + preset

Use core's `loadConfig({ projectRoot: pwd })` to get:
- `preset.modes[MODE].enabled` (preferred) or `preset.roles.enabled` (fallback) — ordered role list
- `preset.modes[MODE].state_machine` — `'full'` or `'fast'` (passed to `nextStep` as `mode`)
- `preset.modes[MODE].thresholds_override` merged on top of `preset.workflow.thresholds`
- `preset.modes?.[MODE]?.g2_enabled` — whether G2 deploy gate is active (default: `true` for nexs, `false` for minimal)
- `i18n.locale` — for state names + conclusion strings

### Constructing `workflow` for `nextStep`

The `workflow` object passed to `nextStep` is assembled from **preset config + progress.md state**:

```js
const presetG2 = preset.modes?.[MODE]?.g2_enabled ?? preset.workflow?.g2_enabled ?? true;
const progress = readProgress(progressPath);
const workflow = {
  g2_enabled: presetG2,
  g2_approved: progress.workflow.g2_approved,
  g2_approved_sprints: progress.workflow.g2_approved_sprints,
};
```

This ensures `g2_enabled: false` in minimal preset causes the state machine to skip DEPLOY_GATE entirely.

## Step 2: Dispatch loop

Repeatedly:

1. Read `current_state` from progress.md
2. Call `nextStep({state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow, mode})` from core/lib/state-machine.mjs (mode = `'full'` or `'fast'`)
3. Examine the returned `{next, role, action, stop, parallel, circuitBreaker}`:
   - `circuitBreaker` set → log to progress.md history + spec.md changelog, then transition
   - `stop: true` → output human-gate summary (Step 3) and return
   - `role` set → invoke that role's command per the dispatch table below
   - `parallel` set → **必须**在同一条消息中使用多个 Agent tool call 并发 dispatch 两个角色（见 "并行 dispatch 规则"），两者都完成后再推进状态机
   - `action == 'parse_*_conclusion'` → tail the corresponding md file's conclusion line, choose next state accordingly
4. After the action completes, call `transitionState(progressPath, {from, to, reason})`
4.5. **Sync the per-feature README** so users entering the worktree see fresh state (the README's first line promises "进入目录第一件事：读本文件"). Best-effort, never blocks orchestration:
   ```js
   import { syncFeatureReadme } from '@cc-nexs/core/lib/readme-sync.mjs';
   try {
     const r = syncFeatureReadme({ reqDir: REQ_DIR });
     if (r.reason === 'no_anchor') {
       console.warn(`⚠️ ${REQ_DIR}README.md 缺少 AUTOGEN 锚点，跳过同步。从模板重建或手动加锚点可恢复自动同步。`);
     }
   } catch (e) {
     console.warn(`⚠️ README 同步失败: ${e.message}（不阻塞主流程）`);
   }
   ```
   Reasons returned: `synced` (rewrote), `no_change` (idempotent), `no_anchor` (legacy README, warn), `no_readme` (minimal preset, silent).
5. Recurse to step 1 unless next state is terminal (COMPLETE) or `stop: true`

### Role → command dispatch table

Per-mode mapping. The orchestrator selects the correct slash command based on `MODE` + the `role` field returned by `nextStep`.

| role (from nextStep) | action | full mode command | fast mode command |
|----------------------|--------|-------------------|-------------------|
| `repo-scout` | `recon` | `/cc-nexs:recon` | (folded into `/cc-nexs:fullstack <id> --phase=spec`) |
| `planner` / `pm` | `draft_spec` / `revise_spec` | `/cc-nexs:planner` | (n/a) |
| `tech-lead` / `dev` | `implement` | `/cc-nexs:dev <id> --mode=feat --sprint=N` | (n/a) |
| `tech-lead` / `dev` | `sync_docs` | `/cc-nexs:dev <id> --mode=doc --sprint=N` | (n/a) |
| `sa` / `reviewer` | `review_spec` | `/cc-nexs:sa spec` | `/cc-nexs:review spec <id>` |
| `sa` / `reviewer` | `review_test_cases` | `/cc-nexs:sa test-cases` | (n/a) |
| `sa` / `reviewer` | `review_code` | `/cc-nexs:sa code` | `/cc-nexs:review code <id>` |
| `sa` / `reviewer` | `accept` | (n/a) | `/cc-nexs:review accept <id>` |
| `qa` / `verifier` | `write_cases` | `/cc-nexs:qa cases` | `/cc-nexs:verify initial <id>` |
| `qa` / `verifier` | `run` | `/cc-nexs:qa run` | (folded into `/cc-nexs:verify initial`) |
| `qa` / `verifier` | `regression` | `/cc-nexs:qa regression` | `/cc-nexs:verify regression <id>` |
| `evaluator` | `final_acceptance` | `/cc-nexs:evaluator` | (n/a) |
| `fullstack` | `draft_spec` / `revise_spec` | (n/a) | `/cc-nexs:fullstack <id> --phase=spec` |
| `fullstack` | `implement` / `revise_implementation` | (n/a) | `/cc-nexs:fullstack <id> --phase=build` |
| `fullstack` | `fix_bug` | (n/a) | `/cc-nexs:fullstack <id> --phase=fix --bug=<BUG-ID>` |

Key fast mode distinction:
- `review_code` → `/cc-nexs:review code <id>` — **only** generates `sa-code-review.md` (no acceptance)
- `accept` → `/cc-nexs:review accept <id>` — **only** generates `acceptance.md` (test-report.md is available)

Implementation hint: a small `dispatch(role, action, mode, reqId, extras)` helper picks the command name from this table; the `action` field from `nextStep` directly disambiguates which sub-command to invoke for multi-target roles.

## Step 3: Human gate output

When `next == 'SPEC_PENDING_HUMAN'` and `humanGateApproved == false`, **first call `syncFeatureReadme({ reqDir: REQ_DIR })`** so the README mirrors the freshly produced spec / sa-review state before the human reads it. Then output the gate summary:

```
═══════════════════════════════════════════════════════════════
🚦 [i18n: human_gate_summary_header]
═══════════════════════════════════════════════════════════════

[i18n: labels.feature]: <id> <slug>
[i18n: labels.branch]: $(git branch --show-current)
[i18n: labels.mode]: <full|fast>

【Spec summary】
(extract first paragraph of spec.md "Background" + "Tech Approach")

【Acceptance Criteria table】
(extract AC table from spec.md)

【Sprint slices】          ← full 模式有
(extract Sprint table from spec.md)

【Last review conclusion】
(tail -10 sa-review.md / review.md)

【Key tradeoffs】
(grep for ⚠️ or 【tradeoff】 in spec.md)

═══════════════════════════════════════════════════════════════
👉 [i18n: human_gate_approve]
👉 [i18n: human_gate_revise]
═══════════════════════════════════════════════════════════════
```

Then **return**. Do not call any tool that the approval-gate-guard hook would block.

## Step 3.5: Deploy gate output (G2)

When `action == 'await_deploy_approval'` and `stop: true`, output the G2 gate summary:

```
═══════════════════════════════════════════════════════════════
🚀 [i18n: deploy_gate_summary_header]
═══════════════════════════════════════════════════════════════

[i18n: labels.feature]: <id> <slug>
[i18n: labels.branch]: $(git branch --show-current)
[i18n: labels.mode]: <full|fast>
[i18n: labels.sprint]: M<N>          ← full 模式有

【SA Code Review 结论】
(tail -5 sa-code-review.md 结论行)

【待部署变更摘要】
(git log --oneline origin/master..HEAD | head -10)

【数据库变更】（如有）
(grep -A5 'DDL\|DML\|ALTER\|CREATE' deploy.md)

═══════════════════════════════════════════════════════════════
👉 请按 merge-discipline 完整流程完成部署确认:
   1. git fetch origin test
   2. git checkout test && git pull origin test
   3. git merge --no-ff <feature-branch>
   4. 如有冲突，在 test 分支上直接解决
   5. git push origin test → 部署测试环境
   6. 功能验证通过后执行: /cc-nexs:approve-deploy <id>

   ⚠️ 禁止 rebase origin/test（并行流：feature 独立合入 test 和 master）
═══════════════════════════════════════════════════════════════
```

Then **return**. Pipeline halts until human runs `/cc-nexs:approve-deploy`.

## Step 4: Conclusion parsing rules

| File | Pattern (regex applied to last 30 lines) | Conclusion outcomes |
|------|------------------------------------------|---------------------|
| `sa-review.md` / `review.md` | `^[结论\|Conclusion]:\s*(\S+)` | `PASS` / `NEEDS_REVISION` |
| `sa-code-review.md` / `code-review.md` | same | same |
| `test-report.md` | same | preset-defined `test_pass` / `test_fail` / `待人工执行`(= pass, 不阻塞) |
| `acceptance.md` | `^[验收结果\|Acceptance]:\s*(\S+)` | `acceptance_pass` / `acceptance_fail` |

i18n: the literal strings (`PASS`, `通过`, `PASSED`, etc.) come from preset's `i18n.conclusion_*` settings.

### full 模式 SA_CODE 结论路由

`PARSE_SA_CODE` 结论解析后的路由（G2 门禁插入点）：

| SA_CODE 结论 | 下一状态 | 说明 |
|---|---|---|
| PASS | `SPRINT_<N>_DEPLOY_GATE` | 代码评审通过 → 等待人工部署测试环境 |
| NEEDS_REVISION | `SPRINT_<N>_FIX` | 代码评审未通过 → 开发修复 |

### full 模式 SA_TEST_REVIEW 结论路由

`PARSE_SA_TEST_REVIEW` 解析 `sa-test-review.md` 末尾结论后的路由：

| SA_TEST_REVIEW 结论 | 下一状态 | 说明 |
|---|---|---|
| PASS | `SPRINT_<N>_DOC_SYNC` | 用例评审通过 → Tech Lead 同步文档 |
| NEEDS_REVISION | `SPRINT_<N>_QA_CASES` | 用例评审未通过 → QA 修订用例 |

### fast 模式解析（拆分后）

#### PARSE_CODE_REVIEW（CODE_REVIEW 之后）

只解析 sa-code-review.md：

```bash
CODE=$(tail -20 ${REQ_DIR}sa-code-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
```

| CODE 结论 | 下一状态 | 计数器 |
|---|---|---|
| PASS | DEPLOY_GATE | — |
| NEEDS_REVISION | CODE_REVIEW_NEEDS_REVISION | review_revision++ |

#### PARSE_ACCEPTANCE（ACCEPTANCE 之后）

只解析 acceptance.md（此时 test-report.md 已存在）：

```bash
ACC=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
```

| ACC 验收结果 | 下一状态 | 计数器 |
|---|---|---|
| 通过 | COMPLETE | — |
| 未通过 | ACCEPTANCE_REJECTED | evaluator_reject++ |

`mode=fast` 在 `state == 'TEST'` 后解析 `test-report.md` 末尾结论；`通过 → TEST_PASSED`，`阻塞 → TEST_BLOCKED`。

## Step 4.5: Artifact completeness gate (full mode, before EVAL)

Before transitioning from `SPRINT_<N>_QA_RUN` (or `QA_REGRESSION` PASS) → `SPRINT_<N>_EVAL`, the orchestrator runs a pre-flight check:

```bash
FAILED=0
for f in deploy.md api-doc.md test-report.md; do
  FILE="${REQ_DIR}${f}"
  if [ ! -f "$FILE" ]; then
    echo "❌ $f 不存在，阻塞进入 Evaluator"
    FAILED=1
  elif grep -qE 'YYYY-MM-DD|/api/xxx/yyy|（append）|（自动填）' "$FILE"; then
    echo "❌ $f 仍为模板内容，阻塞进入 Evaluator"
    FAILED=1
  fi
done
if [ $FAILED -ne 0 ]; then
  echo "⚠️ 产物不完整。回退到 SPRINT_${N}_DOC_SYNC 让 Tech Lead 补充文档。"
  # transition back to DOC_SYNC
fi
```

This is the final guardrail — even if earlier steps were skipped, the completeness gate catches template-only artifacts before Evaluator wastes a scoring cycle on incomplete input.

## Step 5: Counter increments

- `*_NEEDS_REVISION` after a review parse → `counters.review_revision++`
- BUG file state regression to FIXED again → `counters.fix_per_bug[BUG-id]++`
- Acceptance fail → `counters.evaluator_reject++`

Counters live in progress.md `Counters` section. Update via simple regex replace.

## Step 6: Termination

Loop exits when:
- `current_state == COMPLETE` → call `syncFeatureReadme({ reqDir: REQ_DIR })` one last time so the README reflects the final state, then print final summary (completed AC × passed users × pending human items × branch state) **and** the worktree cleanup hint below
- `stop: true` from state machine (human gate, or fast-mode `HUMAN_INTERVENTION` circuit breaker)
- A tool call genuinely fails after self-repair attempts

No other condition causes the orchestrator to stop and wait for user input.

### Compound learnings hint (always print when reached COMPLETE)

`/cc-nexs:compound` 是状态机外的旁路命令，把本次需求的"非显然教训"沉淀到仓库级 `docs/solutions/<topic>.md`。下次同类需求 RECON 阶段会自动 grep 命中、接入 repo-context.md。这是 cc-nexs 复利的关键环节——但不是每次需求都有非显然教训，所以保留人工触发。

```
💡 沉淀经验（可选）:
   本次需求若有"反复返工 / 现状误判 / BUG 修多次"等非显然教训，建议跑:
     /cc-nexs:compound <id>
   会扫 doc/<id>/*.md 提炼成 docs/solutions/<topic>.md。
   下次同类需求 RECON 阶段 Repo Scout 会自动接入这些经验。
   无强信号时 compound 会跳过，不会产出空文件。
```

### Worktree cleanup hint (only when `IN_WORKTREE=1` and reached COMPLETE)

cc-nexs does not auto-remove the worktree — the user might still want to run end-to-end checks, hotfix, or rebase. Print the manual cleanup recipe:

```
📦 Push & MR (manual):
   1. git push -u origin <BRANCH>
   2. 创建两个 MR（不自动合并）:
      ① <BRANCH> → test    <MR_URL_TEST>
      ② <BRANCH> → master  <MR_URL_MASTER>
      建议顺序：先合 test → 测试通过 → 再合 master
   3. 合并完成后清理 worktree:
      cd <REPO_ROOT>
      git worktree remove .worktrees/<id>-<slug>
      git branch -d <BRANCH>
   或保留 worktree 继续做 hotfix / 二次验证。
```

### Doc repo commit (always when reached COMPLETE or any doc file was written)

`all-docs/` 是独立 git 仓库，文档变更需要在其中单独提交。每次状态机推进产生文档写入后，执行以下步骤：

```bash
DOC_REPO="all-docs"
DOC_FEATURE_DIR="all-docs/doc/<id>.<slug>"

# 检测 all-docs 是否是独立 git 仓库
if [ -d "${DOC_REPO}/.git" ] || git -C "$DOC_REPO" rev-parse --git-dir >/dev/null 2>&1; then
  cd "$DOC_REPO"
  git add "doc/<id>.<slug>/"

  # 有变更才 commit
  if ! git diff --cached --quiet; then
    git commit -m "docs: <id> <当前阶段简述>"
    git push origin master
    echo "📄 all-docs 已提交并推送到 master"
  else
    echo "📄 all-docs 无新变更"
  fi
  cd -
fi
```

**时机**：
- 每个状态机 step 完成后（写了 spec.md / sa-review.md / test-report.md 等任何 doc 文件时）
- COMPLETE 终态时做最后一次兜底 commit（确保不遗漏）

**commit message 规范**：
- `docs: <id> planner 产出 spec + 验收契约`
- `docs: <id> SA 评审 Round 1 PASS`
- `docs: <id> QA 测试报告 Sprint M1`
- `docs: <id> Evaluator 验收通过`
- `docs: <id> hotfix BUG-<N> 修复记录`

**注意**：
- all-docs 直接提交 master，不建 feature 分支
- `git push` 失败时不阻塞主流程，打印警告继续
- 不要把代码仓库的文件误提交到 all-docs（`git add` 只点名 `doc/<id>.<slug>/`）

MR URL 生成逻辑（由 agent 在输出时计算，针对**代码仓库**）：

```bash
REMOTE_URL=$(git remote get-url origin)
# 去掉 .git 后缀、ssh 前缀统一为 https
REPO_URL=$(echo "$REMOTE_URL" | sed -E 's|^git@([^:]+):|https://\1/|; s|\.git$||')
HOST=$(echo "$REPO_URL" | sed -E 's|https://([^/]+)/.*|\1|')

if echo "$HOST" | grep -qiE "github"; then
  # GitHub: compare URL
  MR_URL_TEST="${REPO_URL}/compare/test...${BRANCH}?expand=1"
  MR_URL_MASTER="${REPO_URL}/compare/master...${BRANCH}?expand=1"
elif echo "$HOST" | grep -qiE "gitlab"; then
  # GitLab: merge_requests/new
  MR_URL_TEST="${REPO_URL}/-/merge_requests/new?merge_request[source_branch]=${BRANCH}&merge_request[target_branch]=test"
  MR_URL_MASTER="${REPO_URL}/-/merge_requests/new?merge_request[source_branch]=${BRANCH}&merge_request[target_branch]=master"
fi
```

Where `<REPO_ROOT>` is the path printed in Step -1. Do not actually run `git worktree remove` or `git push` for the code repo — let the user decide. The doc repo push is automatic.
