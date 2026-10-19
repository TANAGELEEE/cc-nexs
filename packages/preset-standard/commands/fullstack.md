---
description: "Fullstack entry point for fast mode. After spec, implement in parallel per the approved repository assignments, then have a single owner sync the docs."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[feature ID] [--phase=spec|build|build-sync|fix|review-fix] [--assignment=IMP-id] [--bug=BUG-id]"
---

# /cc-nexs:fullstack

Invoke the `fullstack-claude` agent through the Task tool. In fast mode it replaces `/cc-nexs:planner` + `/cc-nexs:dev` from full mode.

Arguments:

- `$1` = feature ID
- `--phase=spec` produces only spec.md (called on REQ_DRAFTED → SPEC_DRAFTED)
- `--phase=build --assignment=IMP-id` is a parallel code-only worker that writes only the repository/worktree and Allowed paths of that Assignment
- `--phase=build-sync` is run by the single Fullstack after all workers join and aggregate verification passes, to sync dev-plan/api-doc/deploy; changing business code is forbidden
- When a historical spec has no ownership machine block, `--phase=build` retains single-worker coding + doc-sync compatibility
- `--phase=fix --bug=BUG-id` fixes the specified BUG (called at SPRINT_FIX)
- `--phase=review-fix` fixes the Reviewer's latest NEEDS_REVISION and does not require a BUG id
- When no phase is specified, it is determined automatically from current_state in progress.md

## Steps

### 1. Validate mode

Read `all-docs/doc/<编号>/config.json`; it must be `mode=fast`; a historical `mode=lite` is normalized to fast-compatible semantics.
```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ "$MODE" != "fast" ] && [ "$MODE" != "lite" ] && {
  echo "❌ /cc-nexs:fullstack 仅 fast 模式可用，当前 mode=$MODE"
  echo "   full 模式请用 /cc-nexs:planner + /cc-nexs:dev"
  exit 1
}
```
### 2. Decide the phase
```bash
if [ -n "$EXPLICIT_PHASE" ]; then
  PHASE=$EXPLICIT_PHASE
else
  STATE=$(grep '^current_state:' "${REQ_DIR}progress.md" | head -1 | awk '{print $2}')
  case "$STATE" in
    REQ_DRAFTED|SPEC_NEEDS_REVISION) PHASE=spec ;;
    SPEC_APPROVED|SPRINT_BUILD)      PHASE=build ;;
    SPRINT_FIX|TEST_BLOCKED)          PHASE=fix ;;
    FIX_REVIEW_NEEDS_REVISION)        PHASE=review-fix ;;
    *)
      echo "❌ 当前状态 $STATE，不适合调 Fullstack"
      exit 1
      ;;
  esac
fi
```
### 3. Pre-validation

- `phase=spec`: requirements.md must be non-empty; **`repo-context.md` must exist** (the fast-mode state machine does not expose RECON_DONE, so this command performs the fallback check; if it is missing, the command first calls `/cc-nexs:recon` internally, then continues)
- `phase=build`: spec.md must exist and progress.md.human_approved_at must be non-empty
- `phase=build --assignment`: the G1 binding must still match the spec; the Assignment must belong to M1 and to a repository already allocated in progress.json
- `phase=build-sync`: all Assignments succeeded, the returned paths have been validated, and the aggregate build/test/lint for each repository has passed
- `phase=fix`: `--bug=BUG-<n>` must be passed, and the BUG file status must be OPEN; after local verification it may only reach FIXED
- `phase=review-fix`: the latest conclusion in sa-code-review.md must be NEEDS_REVISION

If any condition is not met, report an error immediately and show a hint.
```bash
if [ "$PHASE" = "spec" ] && [ ! -s "${REQ_DIR}repo-context.md" ]; then
  echo "📡 fast 模式 spec 前置：repo-context.md 缺失，先跑 recon"
  /cc-nexs:recon "$1" || { echo "❌ recon 失败"; exit 1; }
fi
```
### 4. Invoke the fullstack-claude agent

Via the Task tool:
```
subagent_type: general-purpose（或 cc-nexs 自定义 fullstack-claude，看 Claude Code 实际加载情况）
prompt:
  你是 Fullstack（fast 模式，独立 session）。
  按 ${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT}}}}/agents/fullstack-claude.md 的 ${PHASE} 模式执行。
  需求目录: ${REQ_DIR}
  ${BUG_ID:+BUG: ${BUG_ID}}
  ${ASSIGNMENT_ID:+Assignment: ${ASSIGNMENT_ID}（只读取表中对应 AC/repository/Allowed paths/Validation）}

  必读输入（phase=spec 时硬性）：
  - ${REQ_DIR}requirements.md     业务诉求
  - ${REQ_DIR}repo-context.md     Repo Scout 现状清单（同类表/Service/页面/API）

  spec 起草时必须填"现状对照"小节，逐条标注 复用 / 扩展 / 新建。
  assignment worker 禁写 dev-plan.md/api-doc.md/deploy.md；只返回精确 changed paths、验证证据和建议 candidate message。
  build-sync 只写共享文档，禁止改业务代码。
```
### 5. Validate Outputs

- `phase=spec`: After the Fullstack subagent exits, the parent orchestrator must first run `sync-implementation-worktrees <id>`, creating and persisting only the missing assignments for workspaces in the table that are not docs repositories; then it must verify that spec.md contains the implementation-ownership machine block and ≥ 3 ACs, and that `validate-implementation-plan` passes. Neither deterministic command may be delegated to a subagent; sync is allowed only before G1, and repeated calls are no-ops.
- `phase=build --assignment`: all changed paths are within that repository plus the Allowed paths; the local validation matched by the configuration passes; no shared docs are written
- `phase=build-sync`: the M1 section has been appended to dev-plan.md / api-doc.md / deploy.md, and there are no business code changes
- Legacy single-worker `phase=build`: aggregated build/test/lint passes and shared docs are synced
- `phase=fix`: project validation = 0; BUG file status = FIXED; writing VERIFIED is prohibited
- `phase=review-fix`: project validation = 0; return the exact candidate path and wait for the new Reviewer invocation

### 6. Do Not Advance State

A single `/cc-nexs:fullstack` step does not touch progress.md. `/cc-nexs:run` advances it after parsing the outputs.

## Output
```
✅ Fullstack 完成: phase=<phase>
   assignment / spec.md / 代码 / 文档 / BUG 状态等
👉 接下来: /cc-nexs:run <编号>
```
