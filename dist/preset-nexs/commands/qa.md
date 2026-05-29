---
description: QA 黑盒测试入口。三种 phase：cases（起草用例）/ run（执行）/ regression（回归）。通过 codex CLI 调用，禁读 src/。
allowed-tools: Read, Write, Edit, Bash, Glob, Task
argument-hint: <phase: cases|run|regression> [需求编号] [--sprint=N]
---

# /cc-nexs:qa

参数：
- `$1` = phase: `cases` / `run` / `regression`
- `$2` = 需求编号
- `--sprint=N` （必需）

## 执行步骤

### 1. 解析参数 + 定位文件

```bash
PHASE=$1
REQ_NUM=$2
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
```

### 2. 按 phase 分派

调起 `qa-codex` agent，按 `agents/qa-codex.md` 的三种模式分别执行。

#### phase=cases

```
QA 起草 Sprint M${SPRINT} 测试用例。
读 ${REQ_DIR}spec.md（AC 表 M${SPRINT} 子集）+ ${REQ_DIR}api-doc.md。
append 到 ${REQ_DIR}test-cases.md 的 ## Sprint M${SPRINT} 章节。
契约覆盖率 100%（所有 AC 被 P0/P1 覆盖），边界 + 异常齐全。
禁读 src/ 和 sa-*.md（sa-test-review.md 例外）。
```

#### phase=run

```
QA 执行 Sprint M${SPRINT} 测试。
读 ${REQ_DIR}test-cases.md ## Sprint M${SPRINT} 章节中 auto 的 P0/P1。
真实跑（API：newman/curl，单元：mvn test，E2E：Playwright）。
bug 落 ${REQ_DIR}bugs/BUG-<N>.md（必含可复现脚本到 qa-scripts/）。
append 到 ${REQ_DIR}test-report.md ## Sprint M${SPRINT} Round 1。
必须输出「AC-ID × 用例 × 结果」覆盖审计表。
末尾 结论: 通过 或 阻塞。
QA 物理不可为的标"待人工接入"，不算阻塞。
禁读 src/ 和 sa-code-review.md，禁改代码。
```

#### phase=regression

```
QA 回归 Sprint M${SPRINT}。
读 ${REQ_DIR}bugs/ 下 Sprint M${SPRINT} 相关 + 状态 FIXED 的 BUG。
重跑每个 BUG 的 qa-scripts/BUG-<id>-repro.*。
通过则改 BUG 状态 FIXED → VERIFIED。
失败则保留 FIXED，append 失败原因到 BUG 文件回归记录。
重跑本 sprint P0/P1（防回归）。
append 到 ${REQ_DIR}test-report.md ## Sprint M${SPRINT} 回归 Round R。
末尾 结论: 通过 或 阻塞 + 失败 BUG 清单。
```

### 3. 解析结果

```bash
# 抓 test-report.md 末尾结论
RESULT=$(tail -20 ${REQ_DIR}test-report.md | grep -E '^结论:' | tail -1 | awk '{print $2}')

# 统计 BUG 状态
OPEN=$(grep -l '状态.*OPEN' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
FIXED=$(grep -l '状态.*FIXED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
VERIFIED=$(grep -l '状态.*VERIFIED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)

echo "RESULT:${RESULT} OPEN=${OPEN} FIXED=${FIXED} VERIFIED=${VERIFIED}"
```

### 4. 不推进状态

由 `/cc-nexs:run` 读结论 + BUG 计数后推进。

## 输出

```
✅ QA 完成: phase=<phase> sprint=M<N>
   结论: <通过|阻塞>
   BUG: OPEN <x> / FIXED <y> / VERIFIED <z>
   契约覆盖: <AC 命中 / AC 总数>
   待人工接入: <数量>
👉 接下来: /cc-nexs:run <编号>
```
