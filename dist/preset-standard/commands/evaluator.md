---
description: "Evaluator contract acceptance entry point. The new flow defaults to final, with full acceptance only after the complete requirement is published and passes final QA; sprint is only for legacy per_sprint."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "[requirement ID] [--scope=sprint|final] [--sprint=N]"
---

# /cc-nexs:evaluator

Executor ≠ acceptor. This command is the pipeline's final contract-scoring gatekeeper.

Parameters:
- `$1` = requirement ID
- `--scope=final` (default) / `sprint` (legacy per_sprint only)
- `--sprint=N` (required when scope=sprint)

## Execution steps

### 1. Parse parameters
```bash
REQ_NUM=$1
SCOPE=$(echo "$@" | grep -oE 'scope=[a-z]+' | cut -d= -f2)
SCOPE=${SCOPE:-final}
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
```
### 2. Validate Prerequisites

scope=sprint mode:
- The ## Sprint M${SPRINT} section must exist in ${REQ_DIR}test-report.md
- The ## Sprint M${SPRINT} Regression section must exist in ${REQ_DIR}test-report.md (indicating QA has completed regression)
- No OPEN or FIXED BUGs may exist under ${REQ_DIR}bugs/ (all must be VERIFIED)

scope=final mode:
- The current delivery.test attempt must succeed, and environment_revision must exist
- The end of ${REQ_DIR}test-report.md must be `结论: 通过` for Final Release / Final Regression
- No OPEN or FIXED BUGs may exist under ${REQ_DIR}bugs/
- Each Sprint is not required to produce acceptance first; a Sprint is a development slice, not a delivery/acceptance slice

If any prerequisite is not met → error + prompt to run the corresponding stage first.

### 3. Invoke the evaluator-codex agent

#### scope=sprint
```
你是 Evaluator（独立 session，禁与 QA 同 session）。
按 agents/evaluator-codex.md 的 scope=sprint 执行。

输入仅限：
- ${REQ_DIR}spec.md 的 AC 表 Sprint M${SPRINT} 子集
- ${REQ_DIR}test-report.md ## Sprint M${SPRINT} 章节
- ${REQ_DIR}bugs/ 下状态 VERIFIED 的 BUG

禁读 src/、禁读 sa-*.md、禁读 dev-plan.md。

append 到 ${REQ_DIR}acceptance.md 的 ## Sprint M${SPRINT} - YYYY-MM-DD。
必须输出契约打分表：AC-ID × 描述 × 关联用例 × 用例结果 × 打分(✅/⚠️/❌) × 理由。
未通过条目必须给阻塞原因 + 建议回退步骤。
末尾必须 验收结果: 通过 或 未通过。
```

#### scope=final

```
你是 Evaluator，最终验收。
按 agents/evaluator-codex.md 的 scope=final 执行。

输入：
- ${REQ_DIR}spec.md 全部 AC
- ${REQ_DIR}test-report.md 最终发布/回归章节及环境证据
- ${REQ_DIR}acceptance.md 既有历史（如 legacy 或前一轮最终验收）
- ${REQ_DIR}bugs/ 全部 VERIFIED BUG

append 到 ${REQ_DIR}acceptance.md ## 最终验收 - YYYY-MM-DD。
必须包含：
1. 跨 sprint 契约全量打分表
2. 未通过条目清单
3. 遗留风险
4. 待人工接入清单（QA 物理不可为 vs SOP §Agent 闭环 1/3/4/5 类，分两栏）
5. 上线建议（可上线 / 灰度 / 不建议 + 理由）

禁读 src/、禁读 sa-*.md、禁妥协。
末尾必须 验收结果: 通过 或 未通过。
```
### 4. Parsing Conclusion
```bash
RESULT=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
echo "RESULT:${RESULT}"
```
### 5. States That Do Not Advance

`/cc-nexs:run` reads the conclusion, then advances the state.
- scope=sprint + pass → SPRINT_<N>_DONE
- scope=sprint + fail → roll back as recommended by acceptance.md
- scope=final + pass → COMPLETE
- scope=final + fail → FINAL_ACCEPTANCE_REJECTED → integration revision, re-review, re-release, and final regression

## Output
```
✅ Evaluator 完成: scope=<scope> sprint=M<N>
   验收结果: <通过|未通过>
   契约打分:
     ✅ <数量>  ⚠️ <数量>  ❌ <数量>
   <未通过时输出建议回退步骤>
👉 接下来: /cc-nexs:run <编号>
```

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
