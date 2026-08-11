---
description: "Tech Lead 编码入口。Sprint 实现可按已批准 repository assignment 并行；文档、评审修订与修复保持边界隔离。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号] [--mode=feat|fix|doc|review-fix|integration] [--sprint=N] [--assignment=IMP-id] [--bug=ID]"
---

# /cc-nexs:dev

参数：
- `$1` = 需求编号
- `--mode=feat`（默认）/ `fix` / `doc` / `review-fix` / `integration` / `re-evaluate`
- `--sprint=N` 编码 Sprint N（feat / doc 必需）
- `--assignment=IMP-id` 将 feat 限定为 ownership 表中的一个 repository/worktree/Allowed paths；新 spec 的并行 worker 必传
- `--bug=BUG-<N>` 修 bug（fix 必需）

## 执行步骤

### 1. 校验前置条件

```bash
# 必须在 feature 分支
BRANCH=$(git branch --show-current)
case "$BRANCH" in
  master|main|test)
    echo "❌ 不能在 $BRANCH 分支编码，请切到 feature/<编号>-<短名>"
    exit 1
    ;;
esac

# spec.md 必须存在且已通过 SA + 人工 gate（feat / doc 模式）
if [ "$MODE" = "feat" ] || [ "$MODE" = "doc" ]; then
  STATE=$(grep '^current_state:' ${REQ_DIR}progress.md | awk '{print $2}')
  case "$STATE" in
    SPEC_APPROVED|SPRINT_*) ;;  # 允许
    *) echo "❌ 当前状态 $STATE，spec 未放行，禁止编码"; exit 1 ;;
  esac
fi
```

### 2. 调起 tech-lead-claude agent

通过 Task 工具调起 `tech-lead-claude` agent。Prompt 模板：

#### feat 模式

```
你是 Tech Lead（独立 session）。
先验证 G1 binding 仍匹配当前 spec，再读 Sprint M${SPRINT} 的 Assignment ${ASSIGNMENT_ID}。
只实现该 Assignment 的 AC 子集，且只能写其 repository assigned worktree + Allowed paths，目标：
- Assignment 覆盖的 AC 有对应实现；不得承担 sibling Assignment
- 表中 Validation 与项目配置命中的局部 build / test / lint 命令退出码均为 0
- 遵守目标仓库指令文件和私有 overlay 规则
- 返回精确 changed paths、验证证据和建议 candidate message
按 agents/tech-lead-claude.md 的硬规则执行。
禁改 spec.md / 禁改 AC / 禁改 progress.md。
禁写 dev-plan.md / api-doc.md / deploy.md；这些由现有 DOC_SYNC 单写者阶段处理。
```

#### fix 模式

```
你是 Tech Lead（独立 session）。
读 ${REQ_DIR}bugs/${BUG_ID}.md。
定位根因到具体文件:行 → 在 BUG 文件"根因分析"小节填写。
实现修复 → 在 BUG 文件"修复方案"小节填写。
修复后：
- 项目配置命中的验证命令全部通过
- 把 BUG 文件 state 从 OPEN 改为 FIXED；本地验证绝不能改为 VERIFIED
- commit message: fix(<模块>): <简述> (${BUG_ID})
- 必须回答 BUG 文件中"为什么原测试没抓到"
```

#### doc 模式

```
你是 Tech Lead（独立 session）。
本 sprint 实现与本地验证已完成。同步部署/API 文档，之后再进入 SA 代码评审。
- ${REQ_DIR}api-doc.md：append 本 sprint 新增/修改的 API（路径/入参/返参/错误码）
- ${REQ_DIR}deploy.md：append 本 sprint 部署步骤；DB 变更必须含回滚步骤
不修改代码。
```

#### review-fix 模式

```
读取 sa-code-review.md 最新 NEEDS_REVISION 章节，只修该轮明确问题并同步受影响文档。
不得要求 BUG_ID，不得改 spec/AC。项目验证通过后返回精确 candidate 路径；随后必须进入新的 SA 代码评审。
```

#### integration 模式

```
读取 Integration Review 或最终验收最新未通过项，修复跨 Sprint/跨仓集成问题并同步 api-doc.md、deploy.md、test-cases.md。
不得改 AC；若必须改契约，停止并回到 Planner/G1。
完成项目级构建与测试后返回全部受影响仓库的精确 candidate 路径，随后必须重新执行 integration review。
```

#### re-evaluate 模式（熔断后）

```
你是 Tech Lead（独立 session），熔断重评模式。
读 spec.md 当前技术方案 + sa-code-review.md 历次反馈。
在 spec.md "技术方案" 段加 ## 熔断后修订（YYYY-MM-DD） 子节，记录：
- 原方案不可行的点
- 新方案
- 需要重写的代码范围
不动 AC 表 / 不动 Sprint 切片（除非确实需要重切）。
```

### 3. 编译自检

assignment worker 调用 `/cc-nexs:build` 时仅选择该 repository/changed modules；全部实现 wave join 后，Orchestrator 再按 repository 做一次 aggregate build/test/lint（可跨仓并行、仓内遵守依赖）。任一失败不推进状态、不创建新 candidate。

### 4. 返回候选路径

不得自行 stage 或 commit。单个 worker 返回后只做路径校验；所有 wave 和 aggregate verification 成功后，Orchestrator 才让 Git Custodian 按 repository 串行生成恰好一个候选提交。

### 5. 不推进状态

`/cc-nexs:dev` 单步不动 progress.md，由 `/cc-nexs:run` 推进。

## 输出

```
✅ Tech Lead 完成: mode=<mode> sprint=M<N>
   assignment: <IMP-id 或 legacy-single>
   changed paths: <精确路径>
   project verification: ✅
👉 接下来: /cc-nexs:run <编号>
```
