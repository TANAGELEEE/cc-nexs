---
description: fast 模式 Fullstack 角色入口。一手包办 spec 起草 + 编码 + 文档同步 + bug 修复。仅 fast 模式可用。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
argument-hint: [需求编号] [可选: --phase=spec|build|fix --bug=BUG-id]
---

# /cc-nexs:fullstack

通过 Task 工具调起 `fullstack-claude` agent。fast 模式下取代 full 模式的 `/cc-nexs:planner` + `/cc-nexs:dev`。

参数：

- `$1` = 需求编号
- `--phase=spec` 仅产 spec.md（在 REQ_DRAFTED → SPEC_DRAFTED 时调用）
- `--phase=build` 仅做编码 + 文档同步（在 SPEC_APPROVED → BUILD 时调用）
- `--phase=fix --bug=BUG-id` 修指定 BUG（在 SPRINT_FIX 时调用）
- 不指定 phase 时按 progress.md 的 current_state 自动决定

## 执行步骤

### 1. 校验 mode

读 `doc/<编号>/config.json`，必须 `mode=fast`。

```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ "$MODE" != "fast" ] && {
  echo "❌ /cc-nexs:fullstack 仅 fast 模式可用，当前 mode=$MODE"
  echo "   full 模式请用 /cc-nexs:planner + /cc-nexs:dev"
  exit 1
}
```

### 2. 决定 phase

```bash
if [ -n "$EXPLICIT_PHASE" ]; then
  PHASE=$EXPLICIT_PHASE
else
  STATE=$(grep '^current_state:' "${REQ_DIR}progress.md" | head -1 | awk '{print $2}')
  case "$STATE" in
    REQ_DRAFTED|SPEC_NEEDS_REVISION) PHASE=spec ;;
    SPEC_APPROVED|SPRINT_BUILD)      PHASE=build ;;
    SPRINT_FIX)                       PHASE=fix ;;
    *)
      echo "❌ 当前状态 $STATE，不适合调 Fullstack"
      exit 1
      ;;
  esac
fi
```

### 3. 校验前置

- `phase=spec`：requirements.md 必须非空；**`repo-context.md` 必须存在**（fast 模式状态机不暴露 RECON_DONE，所以由本命令兜底校验，缺失则内部先调 `/cc-nexs:recon` 再继续）
- `phase=build`：spec.md 必须存在且 progress.md.human_approved_at 非空
- `phase=fix`：必须传 `--bug=BUG-<n>`，BUG 文件状态必须是 OPEN

不满足直接报错 + 提示。

```bash
if [ "$PHASE" = "spec" ] && [ ! -s "${REQ_DIR}repo-context.md" ]; then
  echo "📡 fast 模式 spec 前置：repo-context.md 缺失，先跑 recon"
  /cc-nexs:recon "$1" || { echo "❌ recon 失败"; exit 1; }
fi
```

### 4. 调起 fullstack-claude agent

通过 Task 工具：

```
subagent_type: general-purpose（或 cc-nexs 自定义 fullstack-claude，看 Claude Code 实际加载情况）
prompt:
  你是 Fullstack（fast 模式，独立 session）。
  按 ${CLAUDE_PLUGIN_ROOT}/agents/fullstack-claude.md 的 ${PHASE} 模式执行。
  需求目录: ${REQ_DIR}
  ${BUG_ID:+BUG: ${BUG_ID}}

  必读输入（phase=spec 时硬性）：
  - ${REQ_DIR}requirements.md     业务诉求
  - ${REQ_DIR}repo-context.md     Repo Scout 现状清单（同类表/Service/页面/API）

  spec 起草时必须填"现状对照"小节，逐条标注 复用 / 扩展 / 新建。
  完成后仅写文件，不输出额外摘要。
```

### 5. 校验产出

- `phase=spec`：spec.md 必须含五章节标题，AC ≥ 3 条
- `phase=build`：mvn compile = 0；中文字符串自检；api-doc.md / deploy.md 已 append M1 章节
- `phase=fix`：mvn compile = 0；BUG 文件状态 = FIXED

### 6. 不推进状态

`/cc-nexs:fullstack` 单步不动 progress.md。由 `/cc-nexs:run` 解析产出后推进。

## 输出

```
✅ Fullstack 完成: phase=<phase>
   spec.md / 代码 / BUG 状态等
👉 接下来: /cc-nexs:run <编号>
```
