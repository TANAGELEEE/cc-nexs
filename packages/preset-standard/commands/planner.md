---
description: "Planner role entry point. Expands a business requirement into spec.md, including an acceptance contract AC table + Sprint slices. Optional --revise mode revises per SA feedback."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Task"
argument-hint: "[requirement ID] [optional: --revise]"
---

# /cc-nexs:planner

Expands the PM's business requirement into a spec.md that can be reviewed by the SA, implemented in parallel across multiple repos, and scored by the Evaluator.

Parameters:
- `$1` = requirement ID
- `--revise` = revision mode (revise per the last round of feedback in sa-review.md)

## Execution Steps

### 1. Locate the requirement directory
```bash
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${1}*/ 2>/dev/null | head -1)
[ -z "$REQ_DIR" ] && { echo "❌ 需求目录不存在"; exit 1; }
```
### 2. Validate Prerequisite Files

- `${REQ_DIR}requirements.md` must exist and be non-empty → otherwise prompt the user to fill it in first
- `${REQ_DIR}repo-context.md` must exist and be non-empty → otherwise prompt the user to run `/cc-nexs:recon $1` first
  （The Planner is bound by the "do not read src/" constraint，and repo-context.md is its only way to learn about the existing project；the file's absence will cause the spec to be designed in a vacuum）
- In `--revise` mode，`${REQ_DIR}sa-review.md` must exist → otherwise report an error
```bash
[ ! -s "${REQ_DIR}repo-context.md" ] && {
  echo "❌ 缺少 ${REQ_DIR}repo-context.md（Planner 必读输入）"
  echo "👉 先跑: /cc-nexs:recon $1"
  exit 1
}
```
### 3. Launch the Planner subagent

Use the Task tool to invoke the `planner-claude` agent. Prompt template:

**First version**:
```
你是 Planner（独立 session）。

必读输入（缺一不可）：
- ${REQ_DIR}requirements.md     业务诉求
- ${REQ_DIR}repo-context.md     Repo Scout 产出的现状清单（同类表/Service/页面/API）

按 agents/planner-claude.md 的五章节要求产出 ${REQ_DIR}spec.md。
"技术方案"必须点名 repo-context.md 中可复用的既有 Service/类/表；
"影响范围 → 现状对照"必须逐条标注 复用 / 必须新建（带理由）。
必须填写 IMPLEMENTATION-OWNERSHIP 表；多端且位于不同 repository 的 Assignment 默认同 Wave。

禁读 src/、禁写代码、禁改 progress.md。
完成后仅写入 spec.md，不输出额外摘要。
```
**Revision Mode**（with --revise）：
```
你是 Planner（独立 session），修订模式。

必读输入：
- ${REQ_DIR}sa-review.md         末轮的全部"具体问题"清单
- ${REQ_DIR}repo-context.md      Repo Scout 现状清单（修订时仍要参照，避免改出新的脱节）
- ${REQ_DIR}requirements.md      业务诉求

逐条修订 ${REQ_DIR}spec.md 对应段落。
在 spec.md 文件末尾的唯一 `## 变更记录` 表追加一行；固定表头为 `日期 | 变更内容 | 触发原因 | 影响的 AC-ID / Sprint | 操作人`。内容写：根据 SA Round N 修订: <逐条简述>。
**精准修改**：不对未被指出的部分做"顺手优化"。
```
### 4. Validate the output

`${REQ_DIR}spec.md` must contain five section headings:
```bash
required=("业务背景" "技术方案" "影响范围" "实施所有权与并行波次" "验收契约" "Sprint 切片")
for h in "${required[@]}"; do
  grep -q "## ${h}" ${REQ_DIR}spec.md || { echo "❌ spec.md 缺少 ## ${h}"; exit 1; }
done
```
Then run the deterministic validation:
```bash
node "<plugin-root>/lib/cc-nexs-cli.mjs" sync-implementation-worktrees "$1"
node "<plugin-root>/lib/cc-nexs-cli.mjs" validate-implementation-plan "$1"
```
`sync-implementation-worktrees` must be called by the current parent orchestrator after the Planner subagent exits; subagents must not call it. It only creates missing worktrees before G1 for non-docs repositories whose workspace is declared in the ownership table, and writes the authoritative assignment; repeated calls are a no-op. After that, it fails immediately if a new spec's ownership table exists but a repository is unknown, a path escapes, AC/Sprint mismatch occurs, AC coverage is missed, the same Wave targets the same repository, or a dependency is invalid; it must not silently degrade to a single Agent. Historical specs without this machine block remain single-worker compatible.

AC count ≥ 5:
```bash
ac_count=$(grep -cE '^\| AC-[0-9]{3}' ${REQ_DIR}spec.md)
[ $ac_count -lt 5 ] && { echo "❌ AC 不足 5 条"; exit 1; }
```
### 5. Does Not Advance State

The `/cc-nexs:planner` single-step command **does not modify progress.md**. State advancement is handled by the `/cc-nexs:run` orchestrator.

## Output
```
✅ Planner 已产出 spec.md
   AC 总数: <N>
   Sprint 切片数: <N>
   章节齐全: ✅
👉 接下来:
   - 自动流程: /cc-nexs:run <编号>
   - 单独评审: /cc-nexs:sa spec <编号>
```
