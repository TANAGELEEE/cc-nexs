---
description: Compound 角色入口。读完成需求的 doc/<id>/* 把"非显然教训"沉淀到 docs/solutions/<topic>.md，下次同类需求 Repo Scout 自动接入。旁路命令，不进状态机。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
argument-hint: [需求编号] [可选: --force]
---

# /cc-nexs:compound

完成的需求跑这条命令把教训沉淀到仓库级 `docs/solutions/`。下次同类需求 RECON 阶段会自动 grep 命中、接入 repo-context.md。

参数：

- `$1` = 需求编号（必填）
- `--force` = 跳过"current_state == COMPLETE"前置校验，便于回溯历史需求 / 补沉淀

## 执行步骤

### 1. 校验参数

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

### 2. 定位需求目录

```bash
REQ_DIR=$(ls -d doc/${ID}.*/ 2>/dev/null | head -1)
if [ -z "$REQ_DIR" ]; then
  echo "❌ 需求目录不存在: doc/${ID}.*/"
  exit 1
fi
echo "📂 目录: ${REQ_DIR}"
```

### 3. 校验 progress 状态（除非 --force）

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

### 4. 准备 docs/solutions/ 目录

```bash
SOL_DIR="docs/solutions"
mkdir -p "$SOL_DIR"
```

### 5. 启动 Compound 子代理

通过 Task 工具调起 `compound-claude`。Prompt 模板：

```
你是 Compound（独立 session），经验沉淀员。

读 ${REQ_DIR} 下所有文档：
- spec.md（看变更记录有几轮返工）
- sa-review.md / sa-code-review.md（找反复出现的同类反馈）
- bugs/*.md（找修了 ≥ 2 次的 BUG）
- test-report.md（找根因复杂的阻塞）
- acceptance.md（看是否被驳回）
- repo-context.md（看 RECON 阶段的现状假设是否在编码阶段被推翻）
- progress.md 计数器（review_revision / fix_per_bug / evaluator_reject 是事后判断强信号的硬依据）

按 templates/solution.md 的格式产出 docs/solutions/<topic-slug>.md。

强信号过滤（必须命中任一才允许写一条 solution，否则跳过）：
1. 同 BUG 修 ≥ 2 次
2. 同类 SA 反馈跨 ≥ 2 个 sprint
3. RECON 现状假设被推翻（"复用 X" 改成 "新建" 或反之）
4. 验收 ≥ 1 次未通过
5. spec.md 变更记录 ≥ 3 行（含初稿）

dedupe：先 glob ${SOL_DIR}/*.md 检查 frontmatter.slug；命中则 Edit 既有文件（追加 feature id 到 related_features + 在"补充观察"小节追加新观察 + 更新 last_updated），不新建。

frontmatter keywords 必须 ≥ 3 个；少于 3 个直接跳过本条 solution。

产出 ${REQ_DIR}compound-summary.md（agent 文件里有详细格式），列出：
- 强信号检查清单（每项命中/不命中 + 证据）
- 本次新建的 solution slug
- 本次更新的 solution slug
- 跳过的强信号原因

身份铁律：
- 禁强行凑数（无强信号必须在 summary 写"跳过"，不能写空 solution）
- 禁写 spec / 代码 / progress / src/
- 禁修改 doc/${ID}/ 下除 compound-summary.md 之外的任何历史档案

完成后仅写文件，不输出额外摘要。
```

### 6. 校验产出

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

### 7. 不推进状态机

`/cc-nexs:compound` 不修改 progress.md。它是状态机外的旁路命令。

## 输出

```
✅ Compound 完成
   summary: ${REQ_DIR}compound-summary.md
   新建 solution: <N>
   更新 solution: <N>
   跳过强信号: <N>

👉 下一步:
   - 人工 review ${REQ_DIR}compound-summary.md，决定是否信任本次产出
   - 不信任：直接 git checkout 撤销 docs/solutions/ 改动
   - 信任：commit 入库，下次同类需求 RECON 自动接入
```

## 何时不该用

- 状态未到 COMPLETE → 加 --force 才能跑（一般不建议）
- 需求纯文档/typo → 没有强信号可沉淀
- 需求规模太小（单 commit、无 SA 返工、无 BUG）→ 跑也是空跑

## 与其他命令的关系

```
/cc-nexs:run          ← 跑流水线到 COMPLETE
/cc-nexs:compound     ← 本命令，需求收尾后沉淀经验（旁路，可选）
/cc-nexs:recon        ← 下个需求时 Repo Scout 会扫 docs/solutions/，命中即接入
```

## 输出契约

成功路径：
- `${REQ_DIR}compound-summary.md` 存在且含强信号检查章节
- 若声明产出 N 条 solution，`docs/solutions/` 下有对应 N 个文件存在或被更新
- 若声明跳过，`docs/solutions/` 在本次跑后无新增文件
- 不修改 `progress.md`、不修改 `doc/${ID}/` 下其他历史档案
