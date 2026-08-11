---
description: "fast 模式 Fullstack 入口。spec 后按批准的 repository assignment 并行实现，再由单一 owner 同步文档。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号] [--phase=spec|build|build-sync|fix|review-fix] [--assignment=IMP-id] [--bug=BUG-id]"
---

# /cc-nexs:fullstack

通过 Task 工具调起 `fullstack-claude` agent。fast 模式下取代 full 模式的 `/cc-nexs:planner` + `/cc-nexs:dev`。

参数：

- `$1` = 需求编号
- `--phase=spec` 仅产 spec.md（在 REQ_DRAFTED → SPEC_DRAFTED 时调用）
- `--phase=build --assignment=IMP-id` 是并行 code-only worker，只写该 Assignment 的 repository/worktree 与 Allowed paths
- `--phase=build-sync` 在全部 worker join、聚合验证通过后由唯一 Fullstack 同步 dev-plan/api-doc/deploy；禁止改业务代码
- 历史 spec 没有 ownership 机器块时，`--phase=build` 保留单 worker 编码 + 文档同步兼容
- `--phase=fix --bug=BUG-id` 修指定 BUG（在 SPRINT_FIX 时调用）
- `--phase=review-fix` 修 Reviewer 最新 NEEDS_REVISION，不要求 BUG id
- 不指定 phase 时按 progress.md 的 current_state 自动决定

## 执行步骤

### 1. 校验 mode

读 `all-docs/doc/<编号>/config.json`，必须 `mode=fast`；历史 `mode=lite` 规范化为 fast 兼容语义。

```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ "$MODE" != "fast" ] && [ "$MODE" != "lite" ] && {
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
    SPRINT_FIX|TEST_BLOCKED)          PHASE=fix ;;
    FIX_REVIEW_NEEDS_REVISION)        PHASE=review-fix ;;
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
- `phase=build --assignment`：G1 binding 必须仍匹配 spec；Assignment 必须属于 M1 和 progress.json 已分配仓库
- `phase=build-sync`：全部 Assignment 成功、返回路径已校验、每仓 aggregate build/test/lint 已通过
- `phase=fix`：必须传 `--bug=BUG-<n>`，BUG 文件状态必须是 OPEN；本地验证后只能到 FIXED
- `phase=review-fix`：sa-code-review.md 最新结论必须 NEEDS_REVISION

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
  按 ${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT}}}}/agents/fullstack-claude.md 的 ${PHASE} 模式执行。
  需求目录: ${REQ_DIR}
  ${BUG_ID:+BUG: ${BUG_ID}}
  ${ASSIGNMENT_ID:+Assignment: ${ASSIGNMENT_ID}（只读取表中对应 AC/repository/Allowed paths/Validation）}

  必读输入（phase=spec 时硬性）：
  - ${REQ_DIR}requirements.md     业务诉求
  - ${REQ_DIR}repo-context.md     Repo Scout 现状清单（同类表/Service/页面/API）

  spec 起草时必须填"现状对照"小节，逐条标注 复用 / 扩展 / 新建。
  assignment worker 禁写 dev-plan.md/api-doc.md/deploy.md；只返回精确 changed paths、验证证据和建议 candidate message。
  build-sync 只写共享文档，禁止改业务代码。
```

### 5. 校验产出

- `phase=spec`：Fullstack 子代理退出后，父编排器必须先运行 `sync-implementation-worktrees <id>`，仅按表中 workspace 非 docs repository 创建并持久化缺失 assignment；然后校验 spec.md 含实施所有权机器块、AC ≥ 3 条，并通过 `validate-implementation-plan`。两个确定性命令都不得交给子代理，sync 只允许在 G1 前且重复调用为 no-op。
- `phase=build --assignment`：changed paths 全在该 repository + Allowed paths 内；配置命中的局部验证通过；未写共享文档
- `phase=build-sync`：dev-plan.md / api-doc.md / deploy.md 已 append M1 章节且没有业务代码变更
- 历史单 worker `phase=build`：聚合 build/test/lint 通过且共享文档已同步
- `phase=fix`：项目验证 = 0；BUG 文件状态 = FIXED，禁止写 VERIFIED
- `phase=review-fix`：项目验证 = 0；返回精确 candidate 路径，等待新 Reviewer 调用

### 6. 不推进状态

`/cc-nexs:fullstack` 单步不动 progress.md。由 `/cc-nexs:run` 解析产出后推进。

## 输出

```
✅ Fullstack 完成: phase=<phase>
   assignment / spec.md / 代码 / 文档 / BUG 状态等
👉 接下来: /cc-nexs:run <编号>
```
