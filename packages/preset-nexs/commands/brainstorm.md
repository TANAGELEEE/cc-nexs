---
description: Brainstorming 入口。用 Socratic 对话把 PM 一句话诉求展开成结构化 requirements.md，作为 Planner 的输入。在 /cc-nexs:init 之后、/cc-nexs:run 之前调用。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: <需求编号>
---

# /cc-nexs:brainstorm

启动 brainstorming 对话，把 `doc/<编号>.<短名>/requirements.md` 从"一句话诉求"展开成完整的需求文档。

参数：

- `$1` = 需求编号（必填，与 `/cc-nexs:init` 时给出的编号一致）

## 前置约束

本命令激活 [`brainstorming` skill](../skills/brainstorming/SKILL.md)。HARD-GATE 由 skill 强制：

- 禁写 `spec.md` / `dev-plan.md` / 任何 `src/` 代码
- 禁调 Planner / Tech Lead / SA / QA / Evaluator 子代理
- 禁推进 progress.md 状态机
- 用户显式批准 requirements.md 之前不要 invoke `/cc-nexs:run`

## 执行步骤

### 1. 校验参数

```bash
ID="$1"
if [ -z "$ID" ]; then
  echo "❌ 用法：/cc-nexs:brainstorm <需求编号>"
  echo "   示例：/cc-nexs:brainstorm 01"
  echo "   示例：/cc-nexs:brainstorm 14.2"
  exit 1
fi
```

### 2. 定位需求目录

```bash
REQ_DIR=$(ls -d all-docs/doc/${ID}.*/ 2>/dev/null | head -1)
if [ -z "$REQ_DIR" ]; then
  echo "❌ 需求目录不存在: all-docs/doc/${ID}.*/"
  echo "👉 先跑: /cc-nexs:init <需求描述>"
  exit 1
fi
echo "📂 目录: ${REQ_DIR}"
```

### 3. 校验 requirements.md 存在

```bash
REQ_FILE="${REQ_DIR}requirements.md"
[ ! -f "$REQ_FILE" ] && { echo "❌ 缺少 ${REQ_FILE}"; exit 1; }
```

### 4. 检查状态机位置

只允许在 `INIT` 状态启动 brainstorming，避免在 spec 已审过的中后期被误用：

```bash
PROG="${REQ_DIR}progress.md"
if [ -f "$PROG" ]; then
  STATE=$(grep '^current_state:' "$PROG" | head -1 | awk '{print $2}')
  case "$STATE" in
    INIT|"")
      ;;
    *)
      echo "⚠️  当前状态: ${STATE}"
      echo "   brainstorming 设计在 INIT 阶段使用。"
      echo "   后续阶段如果业务诉求要回炉，建议直接编辑 requirements.md + 在变更记录里记一笔。"
      echo "   仍要继续？输入 yes 强制进入。"
      read -r CONFIRM
      [ "$CONFIRM" != "yes" ] && exit 1
      ;;
  esac
fi
```

### 5. 进入 brainstorming 对话

激活 `brainstorming` skill 并按其流程清单逐项推进：

1. 读 `${REQ_FILE}` 当前内容（init 已写入一句话诉求）
2. 读最近 git 提交（`git log --oneline -10`）作为上下文
3. 判断规模——如果一句话诉求覆盖多子系统，先停下让用户拆
4. 一次一问澄清需求；优先多选题
5. 在涉及方向选择处给 2-3 个方案 + 推荐
6. 按 requirements.md 章节顺序逐节写、逐节确认：
   - 业务背景
   - 用户故事
   - 功能清单（含优先级）
   - 非目标
   - 业务规则
   - 外部依赖
7. 用 **Edit 工具**填章节（不要 Write 整文件覆盖，避免丢模板里的元信息）
8. 写完后做自检：占位符 / 内部一致性 / 范围 / 歧义
9. 让用户终审

详细对话纪律见 `skills/brainstorming/SKILL.md`。

### 6. 终审 + 交棒

用户批准后，输出：

```
✅ requirements.md 已成文并通过你的终审。
   文件: ${REQ_FILE}

👉 下一步:
   /cc-nexs:run ${ID}
   就会启动 Planner 展开成 spec.md。
```

**不要**自动调 `/cc-nexs:run`。等用户主动确认。

### 7. 不推进状态机

`/cc-nexs:brainstorm` 不修改 `progress.md`。状态从 `INIT` 推到下一个状态由 `/cc-nexs:run`（首次跑 Planner）负责。

## 何时不该用

- 单文件 typo / 文案修复 → 直接改，别走流水线
- bug 修复 → 用 `/cc-nexs:hotfix`
- 探索性 spike → 别建 doc 目录
- requirements.md 已经手填得很完整 → 直接 `/cc-nexs:run`

## 与其他命令的关系

```
/cc-nexs:init         ← 第 1 步：建目录 + 写一句话诉求
/cc-nexs:brainstorm   ← 第 2 步：本命令，把一句话展成 requirements.md
/cc-nexs:run          ← 第 3 步：Planner 把 requirements.md 展成 spec.md，跑全流程
/cc-nexs:approve-spec ← 唯一人工 gate
```

## 输出契约

成功路径：
- `${REQ_DIR}requirements.md` 各章节非空（用户终审通过）
- 不创建任何其他文件
- 不修改 `progress.md`
- 输出"下一步：/cc-nexs:run"提示
