---
description: "Compound role entry point. Read all-docs/doc/<id>/* for the completed requirement and distill \"non-obvious lessons\" into docs/solutions/<topic>.md, so the Lean Planner picks it up for the next similar requirement. Bypass command; does not enter the state machine."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Bash, Task"
argument-hint: "[Requirement ID] [optional: --force]"
---

# /cc-nexs:compound

For a completed requirement, run this command to distill lessons into the repository-level `docs/solutions/`. The Lean Planner greps it while surveying the current state for the next similar requirement.

Parameters:

- `$1` = requirement ID (required)
- `--force` = skip the "current_state == COMPLETE" precondition check, useful for retroactively reviewing historical requirements / backfilling lessons

## Execution Steps

### 1. Validate Arguments
```bash
ID="$1"
FORCE=0
for arg in "$@"; do
  [ "$arg" = "--force" ] && FORCE=1
done

if [ -z "$ID" ]; then
  echo "❌ 用法：/cc-nexs:compound <需求编号> [--force]"
  echo "   示例：/cc-nexs:compound 01"
  echo "   回溯：/cc-nexs:compound 03 --force"
  exit 1
fi
```
### 2. Locate the requirements directory
```bash
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${ID}.*/ 2>/dev/null | head -1)
if [ -z "$REQ_DIR" ]; then
  echo "❌ 需求目录不存在: all-docs/doc/${ID}.*/"
  exit 1
fi
echo "📂 目录: ${REQ_DIR}"
```
### 3. Validate the progress status (unless --force)
```bash
if [ "$FORCE" != "1" ]; then
  PROG="${REQ_DIR}progress.md"
  if [ ! -f "$PROG" ]; then
    echo "❌ 缺少 progress.md。回溯历史需求请加 --force"
    exit 1
  fi
  STATE=$(grep '^current_state:' "$PROG" | head -1 | awk '{print $2}')
  if [ "$STATE" != "COMPLETE" ]; then
    echo "⚠️  当前状态: ${STATE}，期望 COMPLETE"
    echo "   compound 设计在需求收尾后跑（让所有教训信号沉淀完整）。"
    echo "   要在中间状态跑请显式加 --force。"
    exit 1
  fi
fi
```
### 4. Prepare the docs/solutions/ directory
```bash
SOL_DIR="docs/solutions"
mkdir -p "$SOL_DIR"
```
### 5. Launch the Compound Subagent

Use the Task tool to invoke `compound-claude`. Prompt template:
```
你是 Compound（独立 session），经验沉淀员。

读 ${REQ_DIR} 下所有文档：
- requirements.md / plan.md（现状假设、范围变更记录、Review 与 Test 结论）
- bugs/*.md 或 Hotfix BUG 文档（找修了 ≥ 2 次的 BUG）
- progress.json（counters.review_revision / fix_per_bug、test attempts、Review closure、Gateway B change requests 是事后判断强信号的硬依据）

按 templates/solution.md 的格式产出 docs/solutions/<topic-slug>.md。

强信号过滤（必须命中任一才允许写一条 solution，否则跳过）：
1. 同 BUG 修 ≥ 2 次
2. 集中 Review 被阻塞并进入 delta closure，或 Gateway B 提出 implementation 修改
3. plan 的现状假设被推翻（"复用 X" 改成 "新建" 或反之）
4. test 验收 ≥ 1 次阻塞
5. 范围变更（SCOPE_CHANGE_REQUESTED）重新经过 Gateway A

dedupe：先 glob ${SOL_DIR}/*.md 检查 frontmatter.slug；命中则 Edit 既有文件（追加 feature id 到 related_features + 在"补充观察"小节追加新观察 + 更新 last_updated），不新建。

frontmatter keywords 必须 ≥ 3 个；少于 3 个直接跳过本条 solution。

产出 ${REQ_DIR}compound-summary.md（agent 文件里有详细格式），列出：
- 强信号检查清单（每项命中/不命中 + 证据）
- 本次新建的 solution slug
- 本次更新的 solution slug
- 跳过的强信号原因

身份铁律：
- 禁强行凑数（无强信号必须在 summary 写"跳过"，不能写空 solution）
- 禁写 requirements / plan / 代码 / progress / src/
- 禁修改 all-docs/doc/${ID}/ 下除 compound-summary.md 之外的任何历史档案

完成后仅写文件，不输出额外摘要。
```
### 6. Verify Outputs
```bash
SUMMARY="${REQ_DIR}compound-summary.md"
if [ ! -s "$SUMMARY" ]; then
  echo "❌ Compound 未产出 ${SUMMARY}"
  exit 1
fi

# 强信号检查清单必须存在
if ! grep -q "## 强信号检查" "$SUMMARY"; then
  echo "⚠️  ${SUMMARY} 缺少'强信号检查'章节"
fi

# 如果 summary 声明了"新建" / "更新"，对应文件必须真的存在或已变更
if grep -q "^- 新建：" "$SUMMARY"; then
  declared_new=$(grep -E "^- 新建：docs/solutions/" "$SUMMARY" | sed -E 's/.*docs\/solutions\/([^[:space:]]+\.md).*/docs\/solutions\/\1/' )
  for f in $declared_new; do
    [ ! -f "$f" ] && echo "⚠️  summary 声明新建 $f 但文件不存在"
  done
fi

# 反模式校验：声明跳过却产出了 solution
if grep -q "无非显然教训" "$SUMMARY"; then
  new_count=$(ls -1 "$SOL_DIR"/*.md 2>/dev/null | wc -l)
  prev_count=$(git ls-files "$SOL_DIR"/*.md 2>/dev/null | wc -l)
  if [ "$new_count" -gt "$prev_count" ]; then
    echo "⚠️  summary 写了'跳过'但 ${SOL_DIR}/ 下出现了新文件，请人工核查"
  fi
fi
```
### 7. Does not advance the state machine

`/cc-nexs:compound` does not modify progress.md. It is a bypass command outside the state machine.

## Output
```
✅ Compound 完成
   summary: ${REQ_DIR}compound-summary.md
   新建 solution: <N>
   更新 solution: <N>
   跳过强信号: <N>

👉 下一步:
   - 人工 review ${REQ_DIR}compound-summary.md，决定是否信任本次产出
   - 不信任：直接 git checkout 撤销 docs/solutions/ 改动
   - 信任：commit 入库，下次同类需求 Lean Planner 自动接入
```
## When Not to Use

- Status has not reached COMPLETE → add --force to run (generally not recommended)
- The requirement is purely docs/typo → no strong signal to capture
- The requirement is too small (single commit, no Review rework, no BUG) → running it is just an empty run

## Relationship to Other Commands
```
/cc-nexs:run          ← 跑流水线到 COMPLETE
/cc-nexs:compound     ← 本命令，需求收尾后沉淀经验（旁路，可选）
/cc-nexs:plan         ← 下个需求时 Lean Planner 会扫 docs/solutions/，命中即接入
```
## Output Contract

Success path:
- `${REQ_DIR}compound-summary.md` exists and contains a strong-signal check section
- If it declares N solutions produced, the corresponding N files exist or have been updated under `docs/solutions/`
- If it declares a skip, `docs/solutions/` has no newly added files after this run
- Do not modify `progress.md`, and do not modify other historical archives under `all-docs/doc/${ID}/`

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
