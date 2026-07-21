---
description: Generic orchestrator. Reads authoritative progress.json v2, dispatches enabled roles, and runs until COMPLETE or a human gate.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Task
argument-hint: [feature_id] [--sprint=N | --resume]
---

# /cc-nexs:run

> **Core rule**: after a stage completes, immediately enter the next stage. Do NOT print a summary and wait for user input. **The exceptions** are human gates (`SPEC_PENDING_HUMAN` and `*_DEPLOY_GATE`) — in those cases stop and return.

This command is the generic orchestrator. It loads `cc-nexs.config.yml` + the active `preset.yml`, then drives the state machine in `@cc-nexs/core/lib/state-machine.mjs`.

## Orchestrator Identity & Anti-overreach

> **身份声明**：Orchestrator 只编排，**不写业务产物、不写代码、不写 spec、不评审、不测试**。它可以调用窄权限 Git Custodian 记录角色产出的 candidate；Orchestrator 本身不执行任意 Git 命令。

### 交付物验证协议

成员角色声称"已完成"时，Orchestrator 验证其返回的精确变更路径位于 progress.json 分配的 worktree，且符合角色写入契约。验证通过后调用 Git Custodian stage/commit candidate；禁止用远端 push 作为普通阶段完成条件。

### 禁止自行补救

发现成员交付物缺失时：
- ❌ 禁止 Orchestrator 自己补写或让 Custodian 提交不完整产物
- ✅ 必须重新派发给对应成员，附带缺失文件和契约差异

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

## Step -1: Workspace and assignment check

Locate the workspace root containing `.cc-nexs/workspace.yml`, load it with `loadWorkspaceConfig()`, and run doctor. The command may be launched from the workspace root or any assigned repository worktree. Every role dispatch receives its exact repository worktree from progress.json; stop if a path or branch differs from the recorded assignment.

## Step 0: Locate active feature

Resolve `docs_repository` from workspace configuration, then find `doc/<id>.*` in its assigned feature worktree. Set `REQ_DIR`, `PROGRESS_MD`, and `PROGRESS_JSON` from that path. Never assume the docs repository is nested inside a code repository.

If `progress.json` is missing but progress.md exists, stop and require `/cc-nexs:migrate-progress`; never silently create state that could discard legacy history. For a new feature, init copies both templates.

### Step 0.1: README catch-up sync (defensive)

Every run invocation starts by syncing README to match current progress.md — this covers cases where the previous run was interrupted, manually driven, or crashed mid-step:

```js
import { syncFeatureReadme } from '@cc-nexs/core/lib/readme-sync.mjs';
try { syncFeatureReadme({ reqDir: REQ_DIR }); } catch (_) { /* best-effort */ }
```

This is idempotent: if README is already current, it returns `no_change` and costs nothing.

## Step 0.5: Resolve feature mode

Read `${REQ_DIR}progress.json.mode` first and require `${REQ_DIR}config.json.mode` to agree. Missing values default to `fast`; full mode is opt-in only. A mismatch is a doctor error and must stop orchestration.

```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" 2>/dev/null \
  | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ -z "$MODE" ] && MODE=fast
case "$MODE" in
  full|fast|lite|hotfix) ;;
  *) echo "⚠ unknown mode '$MODE', falling back to fast"; MODE=fast ;;
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

Resolve every dispatched role through `resolveRoleRuntime(preset, role)`. In Claude Code this preserves Claude implementer subagents and Codex CLI reviewers. In Codex it forces independent native agents for all roles and forbids invoking Claude Code or nested Codex CLI. In Pi P2, every role resolves to a package-qualified `pi-subagents` agent; only `preset-standard` fast mode is supported, and Reviewer/Verifier must use Pi settings to resolve a different authenticated model from the implementer. Model policy in public preset files is always `inherit`; never persist a hard-coded model id.

Every dispatch also receives `CC_NEXS_REQ_DIR=<absolute-doc-feature-dir>/` (with trailing separator) and a repository-id → worktree map. Commands must prefer this value over legacy relative-path discovery. Any `all-docs/doc/<id>` wording inside older role prompts is logical artifact notation and resolves to `CC_NEXS_REQ_DIR`, not a required repository name or topology.

### Constructing `workflow` for `nextStep`

The `workflow` object passed to `nextStep` is assembled from **preset config + progress.json v2 state**. `readProgress(progress.md)` automatically delegates to the sibling progress.json when present:

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

1. Read `state` and `revision` from progress.json
2. Call `nextStep({state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow, mode})` from core/lib/state-machine.mjs (mode = `'full'` or `'fast'`)
3. Examine the returned `{next, role, action, stop, parallel, circuitBreaker}`:
   - `circuitBreaker` set → append a progress.json event + spec.md changelog, then transition
   - `stop: true` → output human-gate summary (Step 3) and return
   - `role` set → invoke that role's command per the dispatch table below
   - `parallel` set → **必须**在同一条消息中使用多个 Agent tool call 并发 dispatch 两个角色（见 "并行 dispatch 规则"），两者都完成后再推进状态机
   - `action == 'parse_*_conclusion'` → tail the corresponding md file's conclusion line, choose next state accordingly
4. After the action completes, call `transitionState(progress.md path, {from, to, reason})`; it atomically appends the authoritative v2 event before refreshing the Markdown view. Stale or mismatched transitions fail closed.
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
👉 Git Custodian 已为各仓记录 candidate commit。请由人工或 CI 将对应 candidate
   部署到测试环境；确认部署成功后执行 /cc-nexs:approve-deploy <id>。
   角色和 Orchestrator 不直接 merge/push 目标分支。
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

Counters live in progress.json. Update them through an event-aware core helper; progress.md counters are a rendered mirror and must not be edited as state.

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

### Release finalization (after MR/PR merge proof)

COMPLETE only means the workflow artifacts passed and does not authorize remote deletion. When the user explicitly asks to merge/push to `master`, invoke Git Custodian `prepare`, merge code repositories first and docs last, then invoke `finalizeMergedWorktree()` in the same release task. Finalize fails closed unless each worktree is clean and both local and remote feature tips are contained by the freshly fetched remote base:

```
📦 Candidate ready:
   - progress.json 记录 candidate ref 和目标 base；实时 commit 从 ref 解析（不在 JSON 中制造 SHA 自引用）
   - 创建/合并 MR 或 PR 属于显式发布动作，不由角色隐式执行
   - 用户明确授权合并 master 后，必须在同一任务内运行 /cc-nexs:git-custodian finalize <id>
   - finalize 默认完整删除远端 feature、本地 feature、worktree 和 candidate ref
   - 只有用户明确要求保留远端分支时才使用 --keep-remote
```

### Document repository candidates

The docs repository is treated exactly like every code repository. After a step writes documents, the Orchestrator asks Git Custodian to stage only the configured feature document directory and create/update a candidate commit on the feature branch. It never commits or pushes directly to `master`/`main`.

**时机**：
- 每个状态机 step 完成后（写了 spec.md / sa-review.md / test-report.md 等任何 doc 文件时）
- COMPLETE 终态时做最后一次兜底 commit（确保不遗漏）

**commit message 规范**：
- `docs: <id> planner 产出 spec + 验收契约`
- `docs: <id> SA 评审 Round 1 PASS`
- `docs: <id> QA 测试报告 Sprint M1`
- `docs: <id> Evaluator 验收通过`
- `docs: <id> hotfix BUG-<N> 修复记录`

Candidate metadata is prepared in progress.json before committing; the candidate ref is the SHA authority. For the docs repository this ordering ensures the final commit includes its own metadata and leaves a clean worktree. Publishing a branch, creating a PR/MR, merging, or deleting a remote branch always requires an explicit release action and must not be inferred from ordinary role completion.
