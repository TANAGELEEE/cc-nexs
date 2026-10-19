---
description: "fast mode Verifier entry point. initial runs after the first test release, regression runs after a fix is re-released; both are black-box environment verifications."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Task"
argument-hint: "<mode: initial|regression> [requirement ID]"
---

# /cc-nexs:verify

Invoke the `verifier-codex` agent through the Task tool. In fast mode, it replaces the three stages of full mode: `/cc-nexs:qa cases` + `/cc-nexs:qa run` + `/cc-nexs:qa regression`.

Parameters:

- `$1` = mode: `initial` / `regression`
- `$2` = requirement ID

## Execution steps

### 1. Validate mode + parameters
```bash
VMODE=$1
REQ_NUM=$2
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
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
### 2. Dispatch by mode

#### mode=initial (after the first test release)
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

必须核对当前 release attempt/environment_revision，并在配置的 test app/operations URL 上验证。Claude 使用 chrome-devtools-mcp，Codex 复用当前登录浏览器。Pi 优先通过 ego lite 的 `ego-browser` skill/CLI 在隔离 task Space 中验证；ego lite 不可用时，才使用配置为 `browser_use: true`、`headless: true` 的 computer-use 专用 Verifier，且同一 release attempt 不得切换 provider。
只访问 allowed_hosts；禁从项目文件或 memory 读取明文账号密码。禁读 src/ 和 sa-*.md。禁修代码。
末尾 ${REQ_DIR}test-report.md 必须 结论: 通过 或 阻塞。
```
#### mode=regression (after fix and republish)
```
调起 verifier-codex agent，按 agents/verifier-codex.md 的 mode=regression 执行。

前置：必须存在比阻塞轮次更新的成功 release attempt/environment_revision。
输入：${REQ_DIR}bugs/ 下 Sprint M1 相关且状态为 FIXED 的 BUG。

任务：
1. 重跑每个 FIXED BUG 的 qa-scripts/BUG-<n>-repro.*
2. 部署后复现与受影响回归全部通过 → BUG 状态 FIXED → VERIFIED
3. 失败 → 保留 FIXED + append 失败原因
4. 重跑本 sprint P0/P1 auto 防回归

append 到 ${REQ_DIR}test-report.md ## Sprint M1 回归 Round R。
末尾 结论: 通过 或 阻塞 + 仍失败 BUG 清单。
```
### 3. Parsing Results
```bash
RESULT=$(tail -20 ${REQ_DIR}test-report.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
OPEN=$(grep -l '状态.*OPEN' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
FIXED=$(grep -l '状态.*FIXED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
VERIFIED=$(grep -l '状态.*VERIFIED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
echo "RESULT:${RESULT} OPEN=${OPEN} FIXED=${FIXED} VERIFIED=${VERIFIED}"
```
### 4. Not Advancing the State

After reading the conclusion and BUG count, the orchestrator advances and records the verification evidence for the current release attempt:
- initial passes → ACCEPTANCE
- initial blocked (has OPEN BUG) → SPRINT_FIX
- regression passes (all VERIFIED) → ACCEPTANCE
- regression fails → fix_per_bug++ back to SPRINT_FIX

## Output
```
✅ Verifier 完成: mode=<mode>
   结论: 通过|阻塞
   BUG: OPEN <x> / FIXED <y> / VERIFIED <z>
   契约覆盖: <AC 命中 / AC 总数>
   待人工接入: <数量>
👉 接下来: /cc-nexs:run <编号>
```

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
