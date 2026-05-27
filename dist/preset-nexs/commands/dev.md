---
description: Tech Lead 编码入口。三种模式：feat（sprint 编码）/ fix（修 bug）/ doc（同步文档）。每次完成后 mvn compile + 中文字符串自检。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
argument-hint: [需求编号] [--mode=feat|fix|doc] [--sprint=N | --bug=ID]
---

# /cc-nexs:dev

参数：
- `$1` = 需求编号
- `--mode=feat` （默认）/ `fix` / `doc` / `re-evaluate`
- `--sprint=N` 编码 Sprint N（feat / doc 必需）
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
读 ${REQ_DIR}spec.md，重点是 Sprint M${SPRINT} 覆盖的 AC-ID 子集。
实现该 sprint 的代码，目标：
- 该 sprint 所有 AC 都有对应实现
- mvn compile 退出码 = 0
- 代码无中文字符串（注释/log 除外）
- Spring bean 名全局唯一
- 单 sprint commit ≤ 10
按 agents/tech-lead-claude.md 的硬规则执行。
禁改 spec.md / 禁改 AC / 禁改 progress.md。
```

#### fix 模式

```
你是 Tech Lead（独立 session）。
读 ${REQ_DIR}bugs/${BUG_ID}.md。
定位根因到具体文件:行 → 在 BUG 文件"根因分析"小节填写。
实现修复 → 在 BUG 文件"修复方案"小节填写。
修复后：
- mvn compile = 0
- 把 BUG 文件 state 从 OPEN 改为 FIXED
- commit message: fix(<模块>): <简述> (${BUG_ID})
- 必须回答 BUG 文件中"为什么原测试没抓到"
```

#### doc 模式

```
你是 Tech Lead（独立 session）。
本 sprint 代码已通过 SA 评审。同步部署/API 文档。
- ${REQ_DIR}api-doc.md：append 本 sprint 新增/修改的 API（路径/入参/返参/错误码）
- ${REQ_DIR}deploy.md：append 本 sprint 部署步骤；DB 变更必须含回滚步骤
不修改代码。
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

```bash
mvn compile -q
[ $? -ne 0 ] && { echo "❌ mvn compile 失败"; exit 1; }
cd ..

# 中文字符串检查
violations=$(grep -rn '[一-龥]' src/main/java/ --include='*.java' | grep -vE '(//|/\*|\*|log\.)')
[ -n "$violations" ] && { echo "❌ 发现代码中文字符串:"; echo "$violations"; exit 1; }
```

### 4. 提交 commit

按项目工程规范：

```bash
case "$MODE" in
  feat) MSG="feat: ${REQ_NUM} M${SPRINT} <模块> - <简述>" ;;
  fix)  MSG="fix(<模块>): <简述> (${BUG_ID})" ;;
  doc)  MSG="docs: ${REQ_NUM} M${SPRINT} 同步 api/deploy 文档" ;;
esac
git add <具体文件，不用 git add .>
git commit -m "$MSG"
```

### 5. 不推进状态

`/cc-nexs:dev` 单步不动 progress.md，由 `/cc-nexs:run` 推进。

## 输出

```
✅ Tech Lead 完成: mode=<mode> sprint=M<N>
   commits: <git log --oneline 本次新增>
   mvn compile: ✅
   中文字符串检查: ✅
👉 接下来: /cc-nexs:run <编号>
```
