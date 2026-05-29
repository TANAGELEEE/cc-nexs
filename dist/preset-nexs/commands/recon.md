---
description: Repo Scout 角色入口。读 src/ 把现存同类配置/Service/页面/API 归档成 repo-context.md，作为 Planner 的现状清单输入。在 /cc-nexs:brainstorm 之后、Planner 之前调用（编排器 RECON 阶段会自动跑）。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
argument-hint: [需求编号]
---

# /cc-nexs:recon

启动 Repo Scout 子代理，扫描代码库现状，产出 `all-docs/doc/<编号>.<短名>/repo-context.md`，给 Planner 当 spec 的现状对照基础。

参数：

- `$1` = 需求编号（必填，与 `/cc-nexs:init` 时给出的编号一致）

## 执行步骤

### 1. 校验参数

```bash
ID="$1"
if [ -z "$ID" ]; then
  echo "❌ 用法：/cc-nexs:recon <需求编号>"
  echo "   示例：/cc-nexs:recon 01"
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

### 3. 校验 requirements.md 存在且非空

```bash
REQ_FILE="${REQ_DIR}requirements.md"
if [ ! -s "$REQ_FILE" ]; then
  echo "❌ ${REQ_FILE} 不存在或为空"
  echo "👉 先跑 /cc-nexs:brainstorm ${ID} 把诉求展开成 requirements.md"
  exit 1
fi
```

### 4. 拷贝模板（如需要）

```bash
CTX_FILE="${REQ_DIR}repo-context.md"
if [ ! -f "$CTX_FILE" ]; then
  TEMPLATE=$(node -e "console.log(require.resolve('@cc-nexs/preset-nexs/templates/repo-context.md'))" 2>/dev/null \
    || ls "$(git rev-parse --show-toplevel)"/.claude/plugins/cache/cc-nexs/preset-nexs/templates/repo-context.md 2>/dev/null \
    || ls packages/preset-nexs/templates/repo-context.md 2>/dev/null)
  if [ -z "$TEMPLATE" ]; then
    echo "⚠️  未找到 repo-context.md 模板，Repo Scout 将从空白起草"
  else
    cp "$TEMPLATE" "$CTX_FILE"
    sed -i '' "s/{编号}/${ID}/g" "$CTX_FILE" 2>/dev/null || sed -i "s/{编号}/${ID}/g" "$CTX_FILE"
    echo "📝 已基于模板创建 ${CTX_FILE}"
  fi
fi
```

### 5. 启动 Repo Scout 子代理

通过 Task 工具调起 `repo-scout-claude`。Prompt 模板：

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

### 6. 校验产出

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

### 7. 不推进状态机

`/cc-nexs:recon` 单步命令**不修改 progress.md**。状态推进由 `/cc-nexs:run` 编排器在 `REQ_DRAFTED → RECON_DONE` 阶段自动完成。

## 输出

```
✅ Repo Scout 已产出 repo-context.md
   命中引用数: <N>
   章节完整度: <ok / 缺 X 项>
👉 接下来:
   - 自动流程: /cc-nexs:run <编号>
   - 单独 Planner: /cc-nexs:planner <编号>
```

## 何时不该用

- requirements.md 还没写 → 先跑 `/cc-nexs:brainstorm`
- 绿地仓库（cc-nexs:init 第一个需求） → 可跳过，但建议跑一次留档"无同类"事实
- 单文件 typo / 文案 → 走 `/cc-nexs:hotfix`，不需要 RECON

## 与其他命令的关系

```
/cc-nexs:init         ← 建目录 + 一句话诉求
/cc-nexs:brainstorm   ← 展开 requirements.md
/cc-nexs:recon        ← 本命令，扫现状产 repo-context.md
/cc-nexs:planner      ← 读 requirements + repo-context 产 spec.md
/cc-nexs:run          ← 编排器，自动跑 recon → planner → ...
```
