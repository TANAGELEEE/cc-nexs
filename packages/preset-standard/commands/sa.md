---
description: "SA 评审入口。支持 spec、cases、单 Sprint code、跨 Sprint integration 和发布后 fix code 评审。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "<target: spec|cases|code|integration> [需求编号] [--sprint=N | --scope=final-fix]"
---

# /cc-nexs:sa

参数：
- `$1` = target: `spec` / `cases` / `code` / `integration`
- `$2` = 需求编号
- `--sprint=N` = cases / Sprint code 必需
- `--scope=final-fix` = 发布后修复代码评审，不传 sprint

## 执行步骤

### 1. 解析参数 + 定位文件

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

### 2. 按 target 分派

#### target=spec

调起 `sa-codex` agent，prompt：

```
评审 spec：
读 ${REQ_DIR}spec.md
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

先按 scope 准备 diff 文件：

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

if [ $LINES -gt 1500 ]; then
  echo "⚠️ diff $LINES 行 > 1500，按文件分组拆分"
  # 拆分逻辑：按 java package 分组，每组单独跑一次 codex
fi
```

调起 `sa-codex` agent，prompt：

```
评审 Sprint M${SPRINT} 代码：
diff 已写到 ${DIFF_FILE}
按 agents/sa-codex.md 中 target=code 的清单执行，并加载目标仓库指令文件和私有 overlay 规则
按 P0/P1/P2/P3 分级，单次输出 ≤ 800 行
append 到 ${REQ_DIR}sa-code-review.md（## Sprint M${SPRINT} - Round R - Group A 分隔）
末尾必须 结论: PASS 或 NEEDS_REVISION
```

`--scope=final-fix` 时只评当前 release 后 BUG 对应的新 candidate diff，章节使用 `## Final Fix Release R<N> - Round R`；仍须输出 PASS/NEEDS_REVISION，且不得把本地测试当成部署后回归。

#### target=integration

```
对所有 Sprint 累计 candidate 做一次需求级集成评审。
输入：完整 spec AC、各仓 base...candidate diff、api-doc.md、deploy.md、test-cases.md、既有 Sprint 代码评审结论。
检查跨仓/前后端契约、数据库与发布顺序、配置兼容、跨 Sprint 组合路径、回滚和累计测试覆盖。
不得直接浏览 src/；代码输入必须由 Orchestrator/Git Custodian 生成确定 base 的 diff。
append 到 sa-code-review.md 的 ## Integration Review Round R 章节。
末尾必须 结论: PASS 或 NEEDS_REVISION。
```

### 3. 解析结论

```bash
RESULT=$(tail -20 ${REQ_DIR}sa-*.md | grep -E '^结论:' | tail -1 | awk '{print $2}')
echo "RESULT:${RESULT}"
```

### 4. 不推进状态

由 `/cc-nexs:run` 读结论后推进 progress.md。`/cc-nexs:sa` 仅写 sa-*.md。

## 输出

```
✅ SA 评审完成: target=<target> sprint=<M<N>|final>
   结论: <PASS|NEEDS_REVISION>
   附文件: <sa-*.md 路径>
   <NEEDS_REVISION 时输出问题数：P0=x P1=y P2=z>
```
