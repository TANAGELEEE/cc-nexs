---
description: "SA review entry point. Supports spec, cases, single-Sprint code, cross-Sprint integration, and post-release fix code reviews."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "<target: spec|cases|code|integration> [requirement ID] [--sprint=N | --scope=final-fix]"
---

# /cc-nexs:sa

Parameters:
- `$1` = target: `spec` / `cases` / `code` / `integration`
- `$2` = requirement ID
- `--sprint=N` = required for cases / Sprint code
- `--scope=final-fix` = post-release fix code review; do not pass sprint

## Execution Steps

### 1. Parse parameters + locate files
```bash
TARGET=$1
REQ_NUM=$2
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
SCOPE=$(echo "$@" | grep -oE 'scope=[a-z-]+' | cut -d= -f2)
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)

if [ "$TARGET" = "code" ] && [ -z "$SPRINT" ] && [ "$SCOPE" != "final-fix" ]; then
  echo "❌ target=code 必须传 --sprint=N 或 --scope=final-fix"
  exit 1
fi
```
### 2. Dispatch by target

#### target=spec

Launch the `sa-codex` agent, prompt:
```
评审 spec：
读 ${REQ_DIR}spec.md
先调用确定性 implementation plan 校验；失败直接 NEEDS_REVISION，不得进入 G1。
按 agents/sa-codex.md 中 target=spec 的评审清单执行
append 到 ${REQ_DIR}sa-review.md（## Round N 分隔）
末尾必须 结论: PASS 或 NEEDS_REVISION
```

#### target=cases

```
评审 Sprint M${SPRINT} 测试用例：
读 ${REQ_DIR}spec.md（AC 表 M${SPRINT} 子集）+ ${REQ_DIR}test-cases.md（## Sprint M${SPRINT} 章节）
按 agents/sa-codex.md 中 target=cases 的评审清单执行
append 到 ${REQ_DIR}sa-test-review.md（## Sprint M${SPRINT} Round N 分隔）
末尾必须 结论: PASS 或 NEEDS_REVISION
```
#### target=code

First prepare the diff file according to the scope:
```bash
if [ "$SCOPE" = "final-fix" ]; then
  DIFF_FILE=/tmp/review-final-fix-${REQ_NUM}.diff
  # Orchestrator/Git Custodian 按 progress.json 中各仓 base_commit...candidate ref
  # 生成完整修复 diff 并聚合到本文件；禁止使用 Sprint 路径猜测。
else
  DIFF_FILE=/tmp/review-m${SPRINT}-a.diff
  git diff main...HEAD -- "src/main/java/**/m${SPRINT}/**" "src/main/resources/**" "all-docs/doc/${REQ_NUM}*/*.sql" > $DIFF_FILE
fi
LINES=$(wc -l < $DIFF_FILE)

if [ "$LINES" -gt 1500 ]; then
  echo "ℹ️ diff 较大，按文件分组提供审阅输入；不改变 Sprint 或 candidate 边界"
  # 拆分逻辑：按 java package 分组，每组单独跑一次 codex
fi
```
Invoke the `sa-codex` agent, prompt:
```
评审 Sprint M${SPRINT} 代码：
diff 已写到 ${DIFF_FILE}
按 agents/sa-codex.md 中 target=code 的清单执行，并加载目标仓库指令文件和私有 overlay 规则
按 P0/P1/P2/P3 分级，单次输出 ≤ 800 行
append 到 ${REQ_DIR}sa-code-review.md（## Sprint M${SPRINT} - Round R - Group A 分隔）
末尾必须 结论: PASS 或 NEEDS_REVISION
```
When `--scope=final-fix`, evaluate only the new candidate diff corresponding to the BUG found after the current release, and use `## Final Fix Release R<N> - Round R` for the section heading; you must still output PASS/NEEDS_REVISION, and you must not treat local tests as post-deployment regression.

#### target=integration
```
对所有 Sprint 累计 candidate 做一次需求级集成评审。
输入：完整 spec AC、各仓 base...candidate diff、api-doc.md、deploy.md、test-cases.md、既有 Sprint 代码评审结论。
检查跨仓/前后端契约、数据库与发布顺序、配置兼容、跨 Sprint 组合路径、回滚和累计测试覆盖。
不得直接浏览 src/；代码输入必须由 Orchestrator/Git Custodian 生成确定 base 的 diff。
append 到 sa-code-review.md 的 ## Integration Review Round R 章节。
末尾必须 结论: PASS 或 NEEDS_REVISION。
```
### 3. Parsing Conclusion
```bash
RESULT=$(tail -20 ${REQ_DIR}sa-*.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
echo "RESULT:${RESULT}"
```
### 4. Do not advance the state

After reading the conclusion, `/cc-nexs:run` advances progress.md. `/cc-nexs:sa` only writes sa-*.md.

## Output
```
✅ SA 评审完成: target=<target> sprint=<M<N>|final>
   结论: <PASS|NEEDS_REVISION>
   附文件: <sa-*.md 路径>
   <NEEDS_REVISION 时输出问题数：P0=x P1=y P2=z>
```

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
