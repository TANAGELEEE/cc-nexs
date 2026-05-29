---
description: SA 评审入口。三种 target：spec / cases / code。通过 codex CLI 调用，落到对应 sa-*.md 文件。
allowed-tools: Read, Write, Edit, Bash, Task
argument-hint: <target: spec|cases|code> [需求编号] [可选: --sprint=N]
---

# /cc-nexs:sa

参数：
- `$1` = target: `spec` / `cases` / `code`
- `$2` = 需求编号
- `--sprint=N` = 仅 cases / code 必需，指定哪个 sprint

## 执行步骤

### 1. 解析参数 + 定位文件

```bash
TARGET=$1
REQ_NUM=$2
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
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

先准备 diff 文件：

```bash
DIFF_FILE=/tmp/review-m${SPRINT}-a.diff
git diff main...HEAD -- "src/main/java/**/m${SPRINT}/**" "src/main/resources/**" "all-docs/doc/${REQ_NUM}*/*.sql" > $DIFF_FILE
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
按 agents/sa-codex.md 中 target=code 的清单执行（含 Spring bean 名唯一性检查）
按 P0/P1/P2/P3 分级，单次输出 ≤ 800 行
append 到 ${REQ_DIR}sa-code-review.md（## Sprint M${SPRINT} - Round R - Group A 分隔）
末尾必须 结论: PASS 或 NEEDS_REVISION
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
✅ SA 评审完成: target=<target> sprint=M<N>
   结论: <PASS|NEEDS_REVISION>
   附文件: <sa-*.md 路径>
   <NEEDS_REVISION 时输出问题数：P0=x P1=y P2=z>
```
