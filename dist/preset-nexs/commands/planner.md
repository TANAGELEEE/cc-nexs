---
description: Planner 角色入口。展开业务需求为 spec.md，含验收契约 AC 表 + Sprint 切片。可选 --revise 模式按 SA 反馈修订。
allowed-tools: Read, Write, Edit, Glob, Grep, Task
argument-hint: [需求编号] [可选: --revise]
---

# /cc-nexs:planner

把 PM 的业务需求展开为可被 SA 评审、可被 Tech Lead 实现、可被 Evaluator 打分的 spec.md。

参数：
- `$1` = 需求编号
- `--revise` = 修订模式（按 sa-review.md 末轮反馈修订）

## 执行步骤

### 1. 定位需求目录

```bash
REQ_DIR=$(ls -d all-docs/doc/${1}*/ 2>/dev/null | head -1)
[ -z "$REQ_DIR" ] && { echo "❌ 需求目录不存在"; exit 1; }
```

### 2. 校验前置文件

- `${REQ_DIR}requirements.md` 必须存在且非空 → 否则提示用户先填
- `${REQ_DIR}repo-context.md` 必须存在且非空 → 否则提示用户先跑 `/cc-nexs:recon $1`
  （Planner 受"禁读 src/"约束，repo-context.md 是它了解现有工程的唯一通道；缺失会导致 spec 在真空里设计）
- `--revise` 模式下，`${REQ_DIR}sa-review.md` 必须存在 → 否则报错

```bash
[ ! -s "${REQ_DIR}repo-context.md" ] && {
  echo "❌ 缺少 ${REQ_DIR}repo-context.md（Planner 必读输入）"
  echo "👉 先跑: /cc-nexs:recon $1"
  exit 1
}
```

### 3. 启动 Planner 子代理

通过 Task 工具调起 `planner-claude` agent。Prompt 模板：

**首版**：
```
你是 Planner（独立 session）。

必读输入（缺一不可）：
- ${REQ_DIR}requirements.md     业务诉求
- ${REQ_DIR}repo-context.md     Repo Scout 产出的现状清单（同类表/Service/页面/API）

按 agents/planner-claude.md 的五章节要求产出 ${REQ_DIR}spec.md。
"技术方案"必须点名 repo-context.md 中可复用的既有 Service/类/表；
"影响范围 → 现状对照"必须逐条标注 复用 / 必须新建（带理由）。

禁读 src/、禁写代码、禁改 progress.md。
完成后仅写入 spec.md，不输出额外摘要。
```

**修订模式**（带 --revise）：
```
你是 Planner（独立 session），修订模式。

必读输入：
- ${REQ_DIR}sa-review.md         末轮的全部"具体问题"清单
- ${REQ_DIR}repo-context.md      Repo Scout 现状清单（修订时仍要参照，避免改出新的脱节）
- ${REQ_DIR}requirements.md      业务诉求

逐条修订 ${REQ_DIR}spec.md 对应段落。
在 spec.md 变更记录追加一行：根据 SA Round N 修订: <逐条简述>。
**精准修改**：不对未被指出的部分做"顺手优化"。
```

### 4. 校验产出

`${REQ_DIR}spec.md` 必须包含五章节标题：

```bash
required=("业务背景" "技术方案" "影响范围" "验收契约" "Sprint 切片")
for h in "${required[@]}"; do
  grep -q "## ${h}" ${REQ_DIR}spec.md || { echo "❌ spec.md 缺少 ## ${h}"; exit 1; }
done
```

AC 数量 ≥ 5：
```bash
ac_count=$(grep -cE '^\| AC-[0-9]{3}' ${REQ_DIR}spec.md)
[ $ac_count -lt 5 ] && { echo "❌ AC 不足 5 条"; exit 1; }
```

### 5. 不推进状态

`/cc-nexs:planner` 单步命令**不修改 progress.md**。状态推进由 `/cc-nexs:run` 编排器负责。

## 输出

```
✅ Planner 已产出 spec.md
   AC 总数: <N>
   Sprint 切片数: <N>
   章节齐全: ✅
👉 接下来:
   - 自动流程: /cc-nexs:run <编号>
   - 单独评审: /cc-nexs:sa spec <编号>
```
