---
description: fast 模式 Reviewer 角色入口。三种 target：spec 评审 / 代码评审（仅）/ 契约验收（仅）。通过 codex CLI 调用。
allowed-tools: Read, Write, Edit, Bash, Task
argument-hint: <target: spec|code|accept> [需求编号]
---

# /cc-nexs:review

通过 Task 工具调起 `reviewer-codex` agent。fast 模式下取代 full 模式的 `/cc-nexs:sa` + `/cc-nexs:evaluator`。

参数：

- `$1` = target: `spec` / `code` / `accept`
- `$2` = 需求编号

## 执行步骤

### 1. 校验 mode + 参数

```bash
TARGET=$1
REQ_NUM=$2
REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ "$MODE" != "fast" ] && {
  echo "❌ /cc-nexs:review 仅 fast 模式可用，当前 mode=$MODE"
  exit 1
}
[ "$TARGET" != "spec" ] && [ "$TARGET" != "code" ] && [ "$TARGET" != "accept" ] && {
  echo "❌ target 必须是 spec、code 或 accept"
  exit 1
}
```

### 2. 按 target 分派

#### target=spec

调起 `reviewer-codex` agent，按 agents/reviewer-codex.md 的 target=spec 执行：

```
你是本项目的 Reviewer（fast 模式，独立 codex session）。
读 ${REQ_DIR}spec.md。
按 reviewer-codex.md 的 spec 评审清单执行。
append 到 ${REQ_DIR}sa-review.md（## Round N 分隔）。
末尾必须 结论: PASS 或 NEEDS_REVISION。
```

#### target=code（仅代码评审，G2 前调用）

```bash
# 1. 准备 diff（base 取 config 或默认 origin/master）
DIFF_FILE=/tmp/fast-code-review-${REQ_NUM}.diff
BASE_REF=$(grep -oE '"base_branch"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" 2>/dev/null | grep -oE '"[^"]*"$' | tr -d '"')
BASE_REF=${BASE_REF:-origin/master}
git diff ${BASE_REF}...HEAD -- '*.java' '*.xml' '*.yml' '*.yaml' '*.sql' '*.properties' "${REQ_DIR}" > $DIFF_FILE
LINES=$(wc -l < $DIFF_FILE)

if [ $LINES -gt 1500 ]; then
  echo "⚠️ diff $LINES 行 > 1500，单次 codex 调用风险高"
  echo "   建议先把 diff 拆分（按文件分组），分批跑 review"
fi
```

调起 `reviewer-codex` agent，**仅产出 sa-code-review.md**（不产出 acceptance.md）：

```
你是本项目的 Reviewer（fast 模式）。
diff: ${DIFF_FILE}
本次只做代码评审，不做契约验收（测试尚未执行）。

关注：架构合理性、异常处理、并发安全、SQL 注入、资源泄漏、规范。
按 P0/P1/P2 分级。
append 到 ${REQ_DIR}sa-code-review.md（## Sprint M1 - Round R - YYYY-MM-DD - 结论 分隔）。
单次输出 ≤ 800 行。
末尾输出 结论: PASS 或 NEEDS_REVISION。

禁读 src/、禁读 dev-plan.md。
禁产出 acceptance.md（那是 target=accept 的职责）。
```

#### target=accept（仅契约验收，TEST_PASSED 后调用）

test-report.md 此时已存在。**仅产出 acceptance.md**（不产出 sa-code-review.md）：

```
你是本项目的 Reviewer（fast 模式）。
本次只做契约验收（代码评审已在 G2 前完成）。

【输入】
- ${REQ_DIR}spec.md 的验收契约 AC 表
- ${REQ_DIR}test-report.md 的最末轮章节
- ${REQ_DIR}bugs/ 下状态为 VERIFIED 的 BUG（如有）

对每条 AC 评分：
  ✅ 测试通过 + 实现覆盖 Given/When/Then 全部分支
  ⚠️ 测试通过但部分分支未覆盖
  ❌ 测试阻塞 / 未通过 / 实现缺失

append 到 ${REQ_DIR}acceptance.md（## Sprint M1 + 最终验收 - YYYY-MM-DD 分隔）。
必须含契约打分表（AC-ID × 描述 × 关联用例 × 用例结果 × 打分 × 理由）。
末尾必须 验收结果: 通过 或 未通过。

禁读 src/、禁读 dev-plan.md。
禁产出 sa-code-review.md（那是 target=code 的职责）。
```

### 3. 解析结论

```bash
if [ "$TARGET" = "spec" ]; then
  RESULT=$(tail -20 ${REQ_DIR}sa-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
  echo "RESULT:${RESULT}"
elif [ "$TARGET" = "code" ]; then
  CODE=$(tail -20 ${REQ_DIR}sa-code-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
  echo "RESULT:${CODE}"
elif [ "$TARGET" = "accept" ]; then
  ACCEPT=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
  echo "RESULT:${ACCEPT}"
fi
```

### 4. 不推进状态

orchestrator 读结论后决定：
- spec PASS → SPEC_PENDING_HUMAN
- code PASS → DEPLOY_GATE
- code NEEDS_REVISION → CODE_REVIEW_NEEDS_REVISION
- accept 通过 → COMPLETE
- accept 未通过 → ACCEPTANCE_REJECTED

## 输出

```
✅ Reviewer 完成: target=<target>
   <spec 模式>: 结论: PASS|NEEDS_REVISION
   <code 模式>: 结论: PASS|NEEDS_REVISION（P0=x P1=y）
   <accept 模式>: 验收结果: 通过|未通过（✅<n> ⚠️<n> ❌<n>）
👉 接下来: /cc-nexs:run <编号>
```
