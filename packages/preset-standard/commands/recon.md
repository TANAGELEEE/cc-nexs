---
description: "Repo Scout role entry point. Reads src/ and archives existing configs/Services/pages/APIs of the same kind into repo-context.md as the current-state inventory input for the Planner. Called after /cc-nexs:brainstorm and before the Planner (the orchestrator's RECON stage runs it automatically)."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Bash, Task"
argument-hint: "[requirement ID]"
---

# /cc-nexs:recon

Launches the Repo Scout subagent to scan the current state of the codebase and produce `all-docs/doc/<编号>.<短名>/repo-context.md`, which serves as the current-state reference baseline for the Planner's spec.

Parameters:

- `$1` = requirement ID (required; must match the ID provided at `/cc-nexs:init`)

## Execution Steps

### 1. Validate Parameters
```bash
ID="$1"
if [ -z "$ID" ]; then
  echo "❌ 用法：/cc-nexs:recon <需求编号>"
  echo "   示例：/cc-nexs:recon 01"
  exit 1
fi
```
### 2. Locate the Requirements Directory
```bash
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${ID}.*/ 2>/dev/null | head -1)
if [ -z "$REQ_DIR" ]; then
  echo "❌ 需求目录不存在: all-docs/doc/${ID}.*/"
  echo "👉 先跑: /cc-nexs:init <需求描述>"
  exit 1
fi
echo "📂 目录: ${REQ_DIR}"
```
### 3. Verify that requirements.md exists and is non-empty
```bash
REQ_FILE="${REQ_DIR}requirements.md"
if [ ! -s "$REQ_FILE" ]; then
  echo "❌ ${REQ_FILE} 不存在或为空"
  echo "👉 先跑 /cc-nexs:brainstorm ${ID} 把诉求展开成 requirements.md"
  exit 1
fi
```
### 4. Copy the template（if needed）
```bash
CTX_FILE="${REQ_DIR}repo-context.md"
if [ ! -f "$CTX_FILE" ]; then
  TEMPLATE=$(node -e "console.log(require.resolve('@cc-nexs/preset-standard/templates/repo-context.md'))" 2>/dev/null \
    || ls "$(git rev-parse --show-toplevel)"/.claude/plugins/cache/cc-nexs/preset-standard/templates/repo-context.md 2>/dev/null \
    || ls packages/preset-standard/templates/repo-context.md 2>/dev/null)
  if [ -z "$TEMPLATE" ]; then
    echo "⚠️  未找到 repo-context.md 模板，Repo Scout 将从空白起草"
  else
    cp "$TEMPLATE" "$CTX_FILE"
    sed -i '' "s/{编号}/${ID}/g" "$CTX_FILE" 2>/dev/null || sed -i "s/{编号}/${ID}/g" "$CTX_FILE"
    echo "📝 已基于模板创建 ${CTX_FILE}"
  fi
fi
```
### 5. Start the Repo Scout Subagent

Invoke `repo-scout-claude` through the Task tool. Prompt template:
```
你是 Repo Scout（独立 session），现状勘察员。

读 ${REQ_DIR}requirements.md，提取领域关键词（实体名、表名前缀、API 路径段、页面路由、业务动词）。

按 templates/repo-context.md 的 8 个章节产出 ${REQ_DIR}repo-context.md：
1. 用 Glob + Grep 扫描既有同类：表/Mapper/Service/Controller/页面/DTO/配置开关
2. 每条引用必须带 repo-relative 文件路径 + 行号
3. 每条配 "复用 / 扩展 / 必须新建" 判断 + 一句具体理由
4. 末尾"风险提示"至少 2 条（命名冲突 / schema 演化坑 / 循环依赖 / 配置开关重名 / 测试夹具缺失等）

如果某类别 grep 后确实无命中，明确写"无同类（已 grep <关键词清单>，无命中）"作为证据，不留白。

身份铁律：
- 禁写 spec / 代码 / progress.md
- 禁调任何子代理
- 禁读其他需求目录的 spec/sa-*/acceptance/test-*

完成后仅写入 repo-context.md，不输出额外摘要。
```
### 6. Verify the output
```bash
if [ ! -s "$CTX_FILE" ]; then
  echo "❌ Repo Scout 未产出 ${CTX_FILE}"
  exit 1
fi

# 校验章节齐全
required=("领域关键词" "同类配置" "同类 Service" "同类 Controller" "风险提示")
missing=0
for h in "${required[@]}"; do
  if ! grep -q "## .*${h}" "$CTX_FILE"; then
    echo "⚠️  缺少 ## .*${h} 小节"
    missing=$((missing+1))
  fi
done
[ $missing -gt 2 ] && { echo "❌ 章节缺失过多，请重跑"; exit 1; }

# 软校验：项目级约定 + 既往教训命中（绿地仓库可能两者都空，缺失只警告不阻塞）
optional=("项目级强制约定" "既往教训命中")
for h in "${optional[@]}"; do
  if ! grep -q "## .*${h}" "$CTX_FILE"; then
    echo "ℹ️  ## .*${h} 小节缺失（绿地仓库可忽略；若仓库存在 AGENTS.md/CLAUDE.md 或 docs/solutions/ 请重跑）"
  fi
done

# 校验至少有一条非占位引用（带 :<行号>）
hits=$(grep -cE ':[0-9]+\)?' "$CTX_FILE")
if [ "$hits" -lt 1 ]; then
  echo "⚠️  repo-context.md 没有任何带行号的引用"
  echo "   可能是绿地需求（需在文件开头注明），也可能是 Repo Scout 没真正扫描"
fi
```
### 7. Does Not Advance the State Machine

The `/cc-nexs:recon` single-step command **does not modify progress.md**. State advancement is handled automatically by the `/cc-nexs:run` orchestrator at the `REQ_DRAFTED → RECON_DONE` stage.

## Output
```
✅ Repo Scout 已产出 repo-context.md
   命中引用数: <N>
   章节完整度: <ok / 缺 X 项>
👉 接下来:
   - 自动流程: /cc-nexs:run <编号>
   - 单独 Planner: /cc-nexs:planner <编号>
```
## When Not to Use

- requirements.md not written yet → run `/cc-nexs:brainstorm` first
- Greenfield repository (cc-nexs:init's first requirement) → can be skipped, but running it once is recommended to record the "no similar items" fact
- Single-file typo / copy change → use `/cc-nexs:hotfix`, no RECON needed

## Relationship with Other Commands
```
/cc-nexs:init         ← 建目录 + 一句话诉求
/cc-nexs:brainstorm   ← 展开 requirements.md
/cc-nexs:recon        ← 本命令，扫现状产 repo-context.md
/cc-nexs:planner      ← 读 requirements + repo-context 产 spec.md
/cc-nexs:run          ← 编排器，自动跑 recon → planner → ...
```
