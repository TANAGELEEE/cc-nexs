---
name: role-isolation
description: cc-nexs 五方身份隔离速查。当 Claude 在执行任何 SOP 阶段任务前激活，提醒当前身份的禁令清单和越界自检规则。触发词：planner、tech lead、sa、qa、evaluator、身份隔离、role isolation、五方异构、cross-tool、跨 session。
---

# 五方身份隔离速查

cc-nexs 五个角色严格隔离，session 不同、工具不同、可读文件不同。任何越界都会被 hooks 拦截或被对端 SA 评审 P0 打回。

> **fast 模式（0.3.0+）合并五方为三角色**：Fullstack（=Planner+Tech Lead）/ Reviewer（=SA+Evaluator）/ Verifier（=QA cases+run+regression）。详细矩阵见 `docs/role-map.md` §"fast 模式：三角色矩阵"，本文末尾给一份速查。

## 速查矩阵（full 模式）

| 身份 | 工具 | 可读 | 可写 | 禁读 | 禁写 |
|------|------|------|------|------|------|
| **Planner-Claude** | claude（独立 session） | requirements.md, spec.md, sa-review.md | spec.md | src/, sa-code-review.md, sa-test-review.md, qa-*, acceptance.md, progress.md | src/, progress.md, 其他 sa-*.md, acceptance.md |
| **Tech Lead-Claude** | claude（独立 session） | spec.md, sa-code-review.md, bugs/, dev-plan.md, src/ | src/, dev-plan.md, deploy.md, api-doc.md, bugs/<具体 BUG>.md | acceptance.md, sa-review.md, sa-test-review.md, test-cases.md, test-report.md（参考可，禁改）| **spec.md, acceptance.md, sa-*.md, test-report.md, progress.md** |
| **SA-Codex** | codex CLI | spec.md, test-cases.md, code diff | sa-review.md, sa-test-review.md, sa-code-review.md | progress.md（不需要）| 代码、spec.md、其他角色的 md |
| **QA-Codex** | codex CLI（黑盒）| spec.md, api-doc.md, test-cases.md（写 cases 时）, sa-test-review.md（仅修订时）| test-cases.md, test-report.md, bugs/, qa-scripts/ | **src/, sa-review.md, sa-code-review.md, dev-plan.md, acceptance.md** | src/, sa-*.md, spec.md |
| **Evaluator-Codex** | codex CLI | spec.md, test-report.md, acceptance.md（自身历史）, bugs/（VERIFIED） | acceptance.md | **src/, sa-*.md, dev-plan.md, qa-scripts/** | 任何非 acceptance.md 的文件 |

## 三条黄金纪律

1. **Planner 不写代码，Tech Lead 不改契约。** 二者都用 claude，但身份 prompt 必须开头声明，session 不能同。
2. **QA 是黑盒，Evaluator 更黑盒。** QA 不读源码、不读 SA 评审；Evaluator 在 QA 之上再加一层：连 QA 的 sa-test-review 也不读，只读 spec + test-report + bugs（VERIFIED）。
3. **Evaluator ≠ QA。** 即使都用 codex，必须分两个独立调用。执行人 ≠ 验收人是反作弊核心。

## 越界自检（每次工具调用前问自己）

- 我现在的身份是？（看 prompt 开头声明 + 环境变量 CC_NEXS_ROLE）
- 我要读/写的文件，在该身份允许列表里吗？
- 如果不在 → 立刻停手 → 输出"⚠️ 身份越界：<具体>"提示 → 让 orchestrator 切到正确 session

## 常见越界模式（立即停手）

- Planner 打开 `src/UserService.java` "看看现有实现" → ❌ 立刻停。让 spec 描述 *做什么*，不要描述 *怎么做*
- Tech Lead 在写代码时发现 spec 的 AC 写得不对，"顺手在 spec 里改一下" → ❌ 立刻停。停手切回 Planner，按 §六 走变更流程
- QA 在写复现脚本时打开 `src/` "看看接口签名" → ❌ 立刻停。从 api-doc.md 读签名；找不到就让 Tech Lead 同步 api-doc.md
- Evaluator 在打分前打开 `sa-code-review.md` "参考一下技术评审" → ❌ 立刻停。Evaluator 只看契约和测试结果

## 越界后修复

如果越界已经发生（hook 没拦住或者 hook 没装）：

1. 停止当前操作
2. 在提交 commit 前 `git restore <越界改动的文件>` 撤销
3. 在 progress.md "越界修复记录" 段记一笔
4. 切到正确 session 重做

## 与 hooks 的协同

`hooks/role-boundary-guard.sh` 在 PreToolUse 拦截：

- 通过 `CC_NEXS_ROLE` 环境变量识别 session 身份
- 命中越界规则即 exit 2，工具调用失败
- session 启动时由 commands/*.md 注入 CC_NEXS_ROLE

## fast 模式速查（0.3.0+）

fast 模式三角色合并版。规则更松（合并后取交集），仍由 `role-boundary-guard.mjs` 通过同一 `CC_NEXS_ROLE` env 识别，角色名为 `fullstack` / `reviewer` / `verifier`。

| 身份 | 工具 | 合并自 | 关键禁令 |
|------|------|--------|---------|
| **Fullstack** | claude（独立 session） | Planner + Tech Lead | 禁改 progress.md / acceptance.md / sa-*.md / test-report.md（orchestrator 与 Reviewer/Verifier 拥有这些） |
| **Reviewer** | codex CLI | SA 代码评审 + Evaluator 契约验收 | 禁读 src/（基于 diff）+ dev-plan.md（避免被实现视角污染） |
| **Verifier** | codex CLI（黑盒） | QA cases + run + regression | 禁读 src/ + sa-*.md（含 sa-test-review.md，比 full QA 更严） |

fast 模式三条纪律：

1. **fast 模式没有 TECH_LEAD_REVIEW 兜底岗**：同 BUG 修 2 次失败直接停下要人工，不再降级回方案阶段。
2. **Reviewer 一次产两份输出**：sa-code-review.md + acceptance.md 同时生成（单 codex 调用），但仍按二级标题分两段。
3. **fast 阈值更严**：`review_revision: 2` / `fix_per_bug: 2`（full 是 3 / 3），熔断更快。

何时用 fast：单模块单接口、Sprint 切片 = 1、改动 ≤ 800 行 diff、无并发/事务复杂度。其他场景仍走 full。
