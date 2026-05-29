---
description: fast 模式 Reviewer 角色入口。两种 target：spec 评审 / 代码评审 + 契约验收（合并）。通过 codex CLI 调用。
allowed-tools: Read, Write, Edit, Bash, Task
argument-hint: <target: spec|accept> [需求编号]
---

# /cc-nexs:review

通过 Task 工具调起 `reviewer-codex` agent。fast 模式下取代 full 模式的 `/cc-nexs:sa` + `/cc-nexs:evaluator`。

参数：

- `$1` = target: `spec` / `accept`
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
[ "$TARGET" != "spec" ] && [ "$TARGET" != "accept" ] && {
  echo "❌ target 必须是 spec 或 accept"
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

#### target=accept（核心：评代码 + 验收 一次完成）

```bash
# 1. 准备 diff
DIFF_FILE=/tmp/fast-review-${REQ_NUM}.diff
git diff main...HEAD -- 'src/main/java/**' 'src/main/resources/**' "${REQ_DIR}*.sql" > $DIFF_FILE
LINES=$(wc -l < $DIFF_FILE)

if [ $LINES -gt 1500 ]; then
  echo "⚠️ diff $LINES 行 > 1500，单次 codex 调用风险高"
  echo "   建议先把 diff 拆分（按文件分组），分批跑 review"
fi
```

调起 `reviewer-codex` agent，按 agents/reviewer-codex.md 的 target=accept 执行：

```
你是本项目的 Reviewer（fast 模式）。
diff: ${DIFF_FILE}
本次同时产出代码评审与契约验收。
按 reviewer-codex.md 的 target=accept 清单执行。

任务 1：append 到 ${REQ_DIR}sa-code-review.md（## Sprint M1 - Round R 分隔）
   末尾必须 结论: PASS 或 NEEDS_REVISION。
任务 2：append 到 ${REQ_DIR}acceptance.md（## Sprint M1 + 最终验收 章节）
   必须含契约打分表（AC-ID × 描述 × 关联用例 × 结果 × 打分 × 理由）
   末尾必须 验收结果: 通过 或 未通过。

禁读 src/、禁读 dev-plan.md、禁与 Verifier 同次 codex 调用。
```

### 3. 解析双结论

```bash
if [ "$TARGET" = "spec" ]; then
  RESULT=$(tail -20 ${REQ_DIR}sa-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
  echo "RESULT:${RESULT}"
elif [ "$TARGET" = "accept" ]; then
  CODE=$(tail -20 ${REQ_DIR}sa-code-review.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
  ACCEPT=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
  echo "CODE:${CODE}  ACCEPT:${ACCEPT}"
fi
```

### 4. 不推进状态

orchestrator 读两个结论后决定：
- spec PASS → SPEC_PENDING_HUMAN
- accept CODE=PASS + ACCEPT=通过 → COMPLETE
- 其他组合 → SPRINT_FIX（计数器累加）

## 输出

```
✅ Reviewer 完成: target=<target>
   <spec 模式>: 结论: PASS|NEEDS_REVISION
   <accept 模式>:
     代码评审: PASS|NEEDS_REVISION（P0=x P1=y）
     契约验收: 通过|未通过（✅<n> ⚠️<n> ❌<n>）
👉 接下来: /cc-nexs:run <编号>
```
