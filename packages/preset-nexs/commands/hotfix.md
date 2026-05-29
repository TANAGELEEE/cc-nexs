---
description: Bug 修复入口。按现象自动分档 P0/P1/P2/P3，走对应简化流程。P3 直改、P2 标准 4 步、P0/P1 加码必须 Evaluator 局部打分 + 回归用例。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
argument-hint: <bug 现象描述> [需求编号]
---

# /cc-nexs:hotfix

不经过完整 spec / sprint 流程，直接修 bug。按项目 SOP §十 hotfix 三档分级。

参数：
- `$1` = bug 现象描述（必填，简短一句话）
- `$2` = 关联需求编号（可选，缺省时按当前分支推断）

## 三档分流速查

| 档位 | 触发条件 | 流程 | 跳过项 |
|------|---------|------|--------|
| 🟢 P3 | typo / 文案 / 样式 / 明显笔误，diff ≤ 20 行 / 单文件 / 无逻辑改动 | Tech Lead 直改 → commit | BUG 文件 / SA / Evaluator |
| 🟡 P2 | 常规逻辑 bug / 边界 / 小范围缺陷 | 4 步：BUG 文件 → Tech Lead 修 → SA 轻量评审 → Tech Lead 自测回归 | spec 变更 / Evaluator |
| 🔴 P0/P1 | 线上事故 / 数据错误 / 涉及契约变更 | P2 流程 + Evaluator 局部打分 + 必须补回归用例 + 已上线含回滚步骤 | (无可跳过) |

## 执行步骤

### 1. 自动分档

agent 根据 `$1` 现象描述，按下表判档：

```
关键字命中 → 升档：
  线上 / 生产 / 用户报错 / 数据错误 / 资金 / 鉴权 / 安全     → P0
  接口 500 / 关键流程阻塞 / 测试环境核心功能崩 / 多用户影响 → P1
  常规 bug / 单一接口 / 偶现                                → P2
  typo / 文案 / 样式 / 颜色 / 拼写                          → P3
```

判完档后**显式输出**判档结果 + 理由，不静默：

```
🔍 判档: <P0|P1|P2|P3>
   理由: <现象关键字命中规则>
   流程: <对应流程的简述>
👉 不同意可以手动覆盖：/cc-nexs:hotfix <现象> --level=P2
```

如果用户在命令里显式带 `--level=P0|P1|P2|P3` 强制档位，跳过自动判档。

### 2. 按档执行

#### 🟢 P3 流程（直改）

```bash
# 调起 Tech Lead，diff 必须 ≤ 20 行 / 单文件 / 无逻辑改动
# 直接 commit，message: fix: <简述>
# 不建 BUG 文件、不调 SA、不调 Evaluator
```

#### 🟡 P2 流程（4 步单次闭环）

**Step 2.1 — Tech Lead 写 BUG 文件 + 复现脚本**

调起 `tech-lead-claude` 的特殊 prompt（hotfix 例外允许 Tech Lead 写复现脚本）：

```
建 ${REQ_DIR}bugs/BUG-<N>.md，按 templates/bugs/BUG-template.md。
必填：现象 / 复现步骤 / 根因分析（含"为什么原测试没抓到"）/ 修复方案 / 影响范围。
写可执行复现脚本到 ${REQ_DIR}qa-scripts/BUG-<N>-repro.*。
```

**Step 2.2 — Tech Lead 修复**

```
按 BUG 文件的修复方案修代码。
mvn compile = 0、无中文字符串。
commit: fix(<模块>): <简述> (BUG-<N>)
BUG 状态 OPEN → FIXED。
```

**Step 2.3 — SA 轻量评审（不开独立 sa-code-review.md）**

```bash
git diff main...HEAD -- <修复涉及文件> > /tmp/bug-${BUG_ID}.diff
codex --file /tmp/bug-${BUG_ID}.diff "你是本项目的 SA。评审 BUG-<N> 的修复 diff。
关注：根因是否修到位、是否引入新副作用、是否影响同模块其他路径、是否需要补测试用例。
**直接 append 到 ${REQ_DIR}bugs/BUG-<N>.md 的 ## 评审 章节**（## Round N - YYYY-MM-DD - 结论 分隔），不要单独建 sa-code-review.md。
末尾 结论: PASS 或 NEEDS_REVISION。"
```

NEEDS_REVISION → 回 Step 2.2 修 → 再审，至 PASS。

**Step 2.4 — Tech Lead 自测回归**

```
跑 ${REQ_DIR}qa-scripts/BUG-<N>-repro.* → 通过 → BUG 状态 FIXED → VERIFIED
跑原 spec 该模块的 P0 用例（防回归）
append 到 BUG 文件的 ## 回归 章节
```

#### 🔴 P0/P1 流程（P2 + 加码）

**先做完 P2 全部 4 步**，然后追加：

**Step 3.1 — Evaluator 局部打分**

```
调起 evaluator-codex，scope=sprint 但只针对受影响的 AC 子集。
append 到 ${REQ_DIR}acceptance.md 的 ## 线上缺陷修复 - BUG-<N> 章节。
必须输出契约打分表（仅相关 AC）。
末尾 验收结果: 通过 或 未通过。
```

**Step 3.2 — 补回归用例**

```
在 ${REQ_DIR}test-cases.md 追加一条用例，标 关联BUG: BUG-<N>。
P0/P1 必须，否则下次还会复发。
```

**Step 3.3 — 已上线则补回滚步骤**

```bash
if grep -q "已上线" ${REQ_DIR}deploy.md; then
  在 ${REQ_DIR}deploy.md 追加 ## 生产回滚步骤 - BUG-<N> 章节
fi
```

### 3. 触发完整 SOP 升级

满足以下任一 → 立即停 hotfix，提示走完整 SOP（`/cc-nexs:run`）：

- 修复需要修改 spec.md 的 AC（涉及契约变更）
- 单次修复 diff > 500 行
- 跨模块大范围重构才能修
- 同一 BUG 修超过 3 轮 SA NEEDS_REVISION

提示信息：

```
⚠️ 此 BUG 已超出 hotfix 边界，建议走完整 SOP：
  原因: <具体哪条触发>
  下一步: 把 BUG 转化为新需求 all-docs/doc/<编号>，跑 /cc-nexs:run
```

### 4. 输出

```
✅ Hotfix 完成: BUG-<N>
   档位: <P0|P1|P2|P3>
   diff 行数: <N>
   涉及文件: <数量>
   commit: <hash> fix(...) (BUG-<N>)
   BUG 状态: VERIFIED
   <P0/P1 时输出 Evaluator 验收结果 + 回归用例 ID>
   <已上线时输出回滚步骤 append 位置>

📄 all-docs 已提交: docs: <id> hotfix BUG-<N> 修复记录

📦 Push & MR（代码仓库）:
   git push -u origin <BRANCH>
   创建两个 MR（不自动合并）:
   ① <BRANCH> → test    <MR_URL_TEST>
   ② <BRANCH> → master  <MR_URL_MASTER>
   建议顺序：先合 test → 测试通过 → 再合 master
```

### 5. Doc repo commit

hotfix 产生的 BUG 文件写入 `all-docs/doc/{原需求编号}/bugs/`，完成后自动提交到 all-docs 仓库 master：

```bash
DOC_REPO="all-docs"
if git -C "$DOC_REPO" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$DOC_REPO" add "doc/<原需求编号>/"
  if ! git -C "$DOC_REPO" diff --cached --quiet; then
    git -C "$DOC_REPO" commit -m "docs: <id> hotfix BUG-<N> 修复记录"
    git -C "$DOC_REPO" push origin master || echo "⚠️ all-docs push 失败，不阻塞主流程"
  fi
fi
```

MR URL 生成逻辑同 `/cc-nexs:run` COMPLETE 段（自动 detect remote 域名，GitHub 用 compare URL，GitLab 用 merge_requests/new）。
