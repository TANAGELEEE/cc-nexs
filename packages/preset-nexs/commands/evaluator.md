---
description: Evaluator 契约验收入口。两种 scope：sprint（单 sprint 打分）/ final（全量最终验收）。通过 codex CLI，禁读 src/、禁读 sa-*.md。
allowed-tools: Read, Write, Edit, Bash, Task
argument-hint: [需求编号] [--scope=sprint|final] [--sprint=N]
---

# /cc-nexs:evaluator

执行人 ≠ 验收人。本命令是流水线最终的契约打分守门员。

参数：
- `$1` = 需求编号
- `--scope=sprint` （默认） / `final`
- `--sprint=N` （scope=sprint 必需）

## 执行步骤

### 1. 解析参数

```bash
REQ_NUM=$1
SCOPE=$(echo "$@" | grep -oE 'scope=[a-z]+' | cut -d= -f2)
SCOPE=${SCOPE:-sprint}
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
```

### 2. 校验前置

scope=sprint 模式：
- ${REQ_DIR}test-report.md 的 ## Sprint M${SPRINT} 章节必须存在
- ${REQ_DIR}test-report.md 的 ## Sprint M${SPRINT} 回归 章节必须存在（说明 QA 已回归）
- ${REQ_DIR}bugs/ 下不能有 OPEN 或 FIXED 的 BUG（必须全部 VERIFIED）

scope=final 模式：
- 所有 sprint 的 acceptance.md 章节都存在且 验收结果: 通过
- ${REQ_DIR}test-report.md 末尾汇总章节存在

任一前置不满足 → 报错 + 提示先跑相应阶段。

### 3. 调起 evaluator-codex agent

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
- ${REQ_DIR}acceptance.md 各 sprint 章节
- ${REQ_DIR}test-report.md 最终汇总
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

### 4. 解析结论

```bash
RESULT=$(tail -30 ${REQ_DIR}acceptance.md | grep -E '^验收结果:' | tail -1 | awk '{print $2}')
echo "RESULT:${RESULT}"
```

### 5. 不推进状态

由 `/cc-nexs:run` 读结论后推进。
- scope=sprint + 通过 → SPRINT_<N>_DONE
- scope=sprint + 未通过 → 按 acceptance.md 建议回退
- scope=final + 通过 → COMPLETE
- scope=final + 未通过 → SPEC_REVIEWING（说明 AC 或实现严重偏离）

## 输出

```
✅ Evaluator 完成: scope=<scope> sprint=M<N>
   验收结果: <通过|未通过>
   契约打分:
     ✅ <数量>  ⚠️ <数量>  ❌ <数量>
   <未通过时输出建议回退步骤>
👉 接下来: /cc-nexs:run <编号>
```
