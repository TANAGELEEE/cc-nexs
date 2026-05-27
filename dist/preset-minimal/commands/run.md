---
description: Generic orchestrator. Reads progress.md state, dispatches to enabled roles per preset.yml, runs the state machine until COMPLETE or human gate.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Task
argument-hint: [feature_id] [--sprint=N | --resume]
---

# /cc-nexs:run

> **Core rule**: after a stage completes, immediately enter the next stage. Do NOT print a summary and wait for user input. **The single exception** is `current_state == SPEC_PENDING_HUMAN` — in that case stop and return.

This command is the generic orchestrator. It loads `cc-nexs.config.yml` + the active `preset.yml`, then drives the state machine in `lib/state-machine.mjs`.

## Step 0: Locate active feature

```bash
if [ -n "$1" ]; then
  REQ_DIR=$(ls -d doc/${1}*/ 2>/dev/null | head -1)
else
  REQ_DIR=$(ls -d doc/*/ 2>/dev/null | grep -v _templates | head -1)
fi
[ -z "$REQ_DIR" ] && { echo "No feature directory found under doc/"; exit 1; }
PROGRESS="${REQ_DIR}progress.md"
```

If `progress.md` does not exist, copy from preset `templates/progress.md` and set `current_state: INIT`.

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
- `i18n.locale` — for state names + conclusion strings

## Step 2: Dispatch loop

Repeatedly:

1. Read `current_state` from progress.md
2. Call `nextStep({state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow, mode})` from lib/state-machine.mjs (mode = `'full'` or `'fast'`)
3. Examine the returned `{next, role, action, stop, parallel, circuitBreaker}`:
   - `circuitBreaker` set → log to progress.md history + spec.md changelog, then transition
   - `stop: true` → output human-gate summary (Step 3) and return
   - `role` set → invoke that role's command per the dispatch table below
   - `parallel` set → invoke the parallel role too (full mode only: e.g. QA writes cases while Dev implements)
   - `action == 'parse_*_conclusion'` → tail the corresponding md file's conclusion line, choose next state accordingly
4. After the action completes, call `transitionState(progressPath, {from, to, reason})`
5. Recurse to step 1 unless next state is terminal (COMPLETE) or `stop: true`

### Role → command dispatch table

Per-mode mapping. The orchestrator selects the correct slash command based on `MODE` + the `role` field returned by `nextStep`.

| role (from nextStep) | full mode command | fast mode command |
|----------------------|-------------------|-------------------|
| `planner` / `pm` | `/cc-nexs:planner` | (n/a) |
| `tech-lead` / `developer` / `dev` | `/cc-nexs:dev` | (n/a) |
| `sa` / `reviewer` (spec) | `/cc-nexs:sa spec` | `/cc-nexs:review spec <id>` |
| `sa` / `reviewer` (code) | `/cc-nexs:sa code` | `/cc-nexs:review accept <id>` |
| `qa` / `verifier` (cases) | `/cc-nexs:qa cases` | `/cc-nexs:verify initial <id>` |
| `qa` / `verifier` (run) | `/cc-nexs:qa run` | (folded into `/cc-nexs:verify initial`) |
| `qa` / `verifier` (regression) | `/cc-nexs:qa regression` | `/cc-nexs:verify regression <id>` |
| `evaluator` | `/cc-nexs:evaluator` | (folded into `/cc-nexs:review accept`) |
| `fullstack` (spec) | (n/a) | `/cc-nexs:fullstack <id> --phase=spec` |
| `fullstack` (build) | (n/a) | `/cc-nexs:fullstack <id> --phase=build` |
| `fullstack` (fix) | (n/a) | `/cc-nexs:fullstack <id> --phase=fix --bug=<BUG-ID>` |

Implementation hint: a small `dispatch(role, action, mode, reqId, extras)` helper picks the command name from this table; the action keyword (`review_spec` / `review_code` / `verify_initial` / `verify_regression` / `implement` / `fix_bug` / `draft_spec` / `revise_spec` / `revise_implementation`) disambiguates which sub-target on a multi-target role.

## Step 3: Human gate output

When `next == 'SPEC_PENDING_HUMAN'` and `humanGateApproved == false`:

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

## Step 4: Conclusion parsing rules

| File | Pattern (regex applied to last 30 lines) | Conclusion outcomes |
|------|------------------------------------------|---------------------|
| `sa-review.md` / `review.md` | `^[结论\|Conclusion]:\s*(\S+)` | `PASS` / `NEEDS_REVISION` |
| `sa-code-review.md` / `code-review.md` | same | same |
| `test-report.md` | same | preset-defined `test_pass` / `test_fail` |
| `acceptance.md` | `^[验收结果\|Acceptance]:\s*(\S+)` | `acceptance_pass` / `acceptance_fail` |

i18n: the literal strings (`PASS`, `通过`, `PASSED`, etc.) come from preset's `i18n.conclusion_*` settings.

### fast 模式合并解析

`mode=fast` 在 `state == 'ACCEPT'` 之后 `action == 'parse_accept_conclusion'`，需要**同时解析两个文件**（reviewer 一次产两份）：

```bash
CODE=$(tail -20 ${REQ_DIR}sa-code-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
ACC=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
```

| CODE 结论 | ACC 验收结果 | 下一状态 | 计数器 |
|---|---|---|---|
| PASS | 通过 | COMPLETE | — |
| NEEDS_REVISION | 通过 | ACCEPT_NEEDS_REVISION | review_revision++ |
| PASS | 未通过 | ACCEPT_NEEDS_REVISION | evaluator_reject++ |
| NEEDS_REVISION | 未通过 | ACCEPT_NEEDS_REVISION | review_revision++、evaluator_reject++ |

`mode=fast` 在 `state == 'TEST'` 后解析 `test-report.md` 末尾结论；`通过 → TEST_PASSED`，`阻塞 → TEST_BLOCKED`。

## Step 5: Counter increments

- `*_NEEDS_REVISION` after a review parse → `counters.review_revision++`
- BUG file state regression to FIXED again → `counters.fix_per_bug[BUG-id]++`
- Acceptance fail → `counters.evaluator_reject++`

Counters live in progress.md `Counters` section. Update via simple regex replace.

## Step 6: Termination

Loop exits when:
- `current_state == COMPLETE` → print final summary (completed AC × passed users × pending human items × branch state)
- `stop: true` from state machine (human gate, or fast-mode `HUMAN_INTERVENTION` circuit breaker)
- A tool call genuinely fails after self-repair attempts

No other condition causes the orchestrator to stop and wait for user input.

