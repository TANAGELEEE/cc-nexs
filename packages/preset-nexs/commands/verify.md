---
description: fast 模式 Verifier 角色入口。两种 mode：initial（写 cases + 立即执行）/ regression（回归）。通过 codex CLI 调用，黑盒。
allowed-tools: Read, Write, Edit, Bash, Glob, Task
argument-hint: <mode: initial|regression> [需求编号]
---

# /cc-nexs:verify

通过 Task 工具调起 `verifier-codex` agent。fast 模式下取代 full 模式的 `/cc-nexs:qa cases` + `/cc-nexs:qa run` + `/cc-nexs:qa regression` 三阶段。

参数：

- `$1` = mode: `initial` / `regression`
- `$2` = 需求编号

## 执行步骤

### 1. 校验 mode + 参数

```bash
VMODE=$1
REQ_NUM=$2
REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
PMODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ "$PMODE" != "fast" ] && {
  echo "❌ /cc-nexs:verify 仅 fast 模式可用，当前 mode=$PMODE"
  exit 1
}
[ "$VMODE" != "initial" ] && [ "$VMODE" != "regression" ] && {
  echo "❌ mode 必须是 initial 或 regression"
  exit 1
}
```

### 2. 按 mode 分派

#### mode=initial（首次）

```
调起 verifier-codex agent，按 agents/verifier-codex.md 的 mode=initial 执行。

输入：
  - ${REQ_DIR}spec.md（AC 表）
  - ${REQ_DIR}api-doc.md
  - ${REQ_DIR}deploy.md（如启动命令）

输出：
  - ${REQ_DIR}test-cases.md ## Sprint M1 章节（用例集，含 P0/P1/P2/P3 + auto/manual + 关联 AC）
  - ${REQ_DIR}qa-scripts/ 下可执行脚本
  - ${REQ_DIR}test-report.md ## Sprint M1 Round 1（含 AC-ID × 用例 × 结果审计表）
  - ${REQ_DIR}bugs/BUG-*.md（如发现）+ qa-scripts/BUG-*-repro.*

禁读 src/ 和 sa-*.md。禁修代码。
末尾 ${REQ_DIR}test-report.md 必须 结论: 通过 或 阻塞。
```

#### mode=regression

```
调起 verifier-codex agent，按 agents/verifier-codex.md 的 mode=regression 执行。

输入：${REQ_DIR}bugs/ 下 Sprint M1 相关且状态为 FIXED 的 BUG。

任务：
1. 重跑每个 FIXED BUG 的 qa-scripts/BUG-<n>-repro.*
2. 通过 → BUG 状态 FIXED → VERIFIED
3. 失败 → 保留 FIXED + append 失败原因
4. 重跑本 sprint P0/P1 auto 防回归

append 到 ${REQ_DIR}test-report.md ## Sprint M1 回归 Round R。
末尾 结论: 通过 或 阻塞 + 仍失败 BUG 清单。
```

### 3. 解析结果

```bash
RESULT=$(tail -20 ${REQ_DIR}test-report.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
OPEN=$(grep -l '状态.*OPEN' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
FIXED=$(grep -l '状态.*FIXED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
VERIFIED=$(grep -l '状态.*VERIFIED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
echo "RESULT:${RESULT} OPEN=${OPEN} FIXED=${FIXED} VERIFIED=${VERIFIED}"
```

### 4. 不推进状态

orchestrator 读结论 + BUG 计数后推进：
- initial 通过 → ACCEPT
- initial 阻塞（有 OPEN BUG）→ SPRINT_FIX
- regression 通过（全 VERIFIED）→ ACCEPT
- regression 失败 → fix_per_bug++ 回 SPRINT_FIX

## 输出

```
✅ Verifier 完成: mode=<mode>
   结论: 通过|阻塞
   BUG: OPEN <x> / FIXED <y> / VERIFIED <z>
   契约覆盖: <AC 命中 / AC 总数>
   待人工接入: <数量>
👉 接下来: /cc-nexs:run <编号>
```
