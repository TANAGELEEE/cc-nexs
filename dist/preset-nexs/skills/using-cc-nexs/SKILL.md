---
name: using-cc-nexs
description: cc-nexs 入口被动触发 skill。当用户说"做新需求"、"开发功能"、"start a feature"、"开个分支做"、"build new requirement"、"按 SOP 跑"、"五方流程"、"plan + implement + test"、"全流程开发"、"feature 开发"、"端到端做这个需求" 时自动激活，引导用户进入 cc-nexs 编排流水线。
---

# 使用 cc-nexs 流水线

本 skill 在用户表达"做新需求"或类似意图时被动触发，引导进入 cc-nexs 状态机编排开发流水线。Claude Code 与 Codex 都必须以 `commands/*.md` 为事实来源；Codex 安装时会为每个 `/cc-nexs:*` command 生成同名镜像 skill，但文档写入位置、状态推进和角色边界不允许分叉。

## 何时建议用户走 cc-nexs

- 新功能开发（不是 typo / 文案修复）
- 跨多个 commit 的工作
- 需要 spec → 评审 → 实现 → 测试 → 验收的完整闭环
- 涉及多模块（后端 + 前端）改动

## 何时**不**建议

- 单文件 typo 修复 → 直接改即可
- 探索性 spike（写完就丢）
- 文档撰写
- 小于 50 行的 bug 修复 → 用 `/cc-nexs:hotfix`

## 两种模式：full vs fast

cc-nexs 支持两种模式，在 `all-docs/doc/<编号>/config.json` 的 `mode` 字段选择：

| 模式 | 角色数 | 状态机 | 适用场景 | 子代理调用量 |
|------|--------|--------|---------|---------------|
| **full** | 5 方异构（Planner / Tech Lead / SA / QA / Evaluator） | 多 sprint，full 状态机 | 跨模块、含 DB schema 变更、对外契约、合规风险、Sprint 切片 ≥ 2 | 基线 |
| **fast** | 3 角色合并（Fullstack / Reviewer / Verifier） | 单 sprint，fast 状态机 | 单模块单接口、改动 ≤ 800 行 diff、无并发/事务复杂度 | 比 full 少 ~50% |

**默认 full**。在 init 时按需切到 fast。

## 启动顺序

```
/cc-nexs:init <一句话需求>      ← 建目录 + 写一句话诉求
/cc-nexs:brainstorm <编号>      ← 可选：用 Socratic 对话把诉求展成 requirements.md
/cc-nexs:run <编号>             ← 跑全流程到人工 gate（G1: spec 审批, G2: 部署确认）
```

`brainstorm` 在需求"还很模糊 / PM 自己一句话写不出完整 requirements.md"时强烈推荐。如果 PM 已经线下把 requirements.md 填得很完整，可以跳过直接 `run`。

`run` 自动按 config.json 里的 mode 选择对应状态机和角色，正常流程**只需** `/cc-nexs:run`。

## Codex 侧使用约定

Codex plugin 中每个 command 都有镜像 skill：

- `/cc-nexs:init` → `$cc-nexs-init`
- `/cc-nexs:run` → `$cc-nexs-run`
- `/cc-nexs:approve-spec` → `$cc-nexs-approve-spec`
- `/cc-nexs:hotfix` → `$cc-nexs-hotfix`
- fast 单步：`$cc-nexs-fullstack` / `$cc-nexs-review` / `$cc-nexs-verify`

用户直接输入 `/cc-nexs:run 01` 时，Codex 也应按同一个 command mirror skill 执行。镜像 skill 的第一步永远是读 `commands/<name>.md`，然后按该 command 声明的路径写入 `all-docs/doc/<编号>.<slug>/`、`bugs/`、`qa-scripts/`、`docs/solutions/` 等原位置。

## 流水线行为速记

1. 一次触发，自动跑到人工 gate G1（spec 评审通过后）
2. 人工审核 spec.md 满意后跑 `/cc-nexs:approve-spec`
3. 再跑 `/cc-nexs:run`，自动跑到 G2（代码评审通过后等部署确认）
4. 部署测试环境后跑 `/cc-nexs:approve-deploy`，自动跑完 QA 直到 COMPLETE
4. 任何阶段失败：自循环重试，超阈值自动熔断
5. 物理不可为的（生产部署等）落"待人工接入"清单，不阻塞

fast 模式没有 TECH_LEAD_REVIEW 兜底岗：同一 BUG 修 2 次失败直接停下要人工。

## 启动检查清单

引导用户启动新需求前确认：

- [ ] `all-docs/all-docs/doc/<编号>.<短名>/` 目录已建（用户手动 cp templates/ 过去 或 `/cc-nexs:init`）
- [ ] `requirements.md` 已填业务需求（不会填？跑 `/cc-nexs:brainstorm <编号>` 用对话补全）
- [ ] `config.json` 的 `mode` 字段已确认（默认 full；小改动可改 fast）
- [ ] 已切到 `feature/<编号>-<短名>` 分支
- [ ] 当前工作目录是项目根（含 `all-docs/doc/` 和代码模块目录）

任一缺失 → 提醒用户补，不要替用户做（避免误操作）。

## 与单步命令的关系

```
/cc-nexs:init           ← 第 0 步：建目录 + 写一句话诉求
/cc-nexs:brainstorm     ← 第 1 步（可选）：把诉求 Socratic 展成 requirements.md
/cc-nexs:run            ← 默认入口，自动状态机（按 mode 路由）
                          ┌─ full 模式 ──────────────────┐
                          ├─ /cc-nexs:planner   ← 单步：展开 spec
                          ├─ /cc-nexs:sa        ← 单步：SA 评审
                          ├─ /cc-nexs:dev       ← 单步：Tech Lead 编码
                          ├─ /cc-nexs:qa        ← 单步：QA 测试
                          ├─ /cc-nexs:evaluator ← 单步：Evaluator 打分
                          └────────────────────────────────┘
                          ┌─ fast 模式 ──────────────────┐
                          ├─ /cc-nexs:fullstack ← 单步：Fullstack（spec / build / fix 三阶段）
                          ├─ /cc-nexs:review    ← 单步：Reviewer（spec 评审 / 代码 + 契约验收合并）
                          ├─ /cc-nexs:verify    ← 单步：Verifier（首次 cases+run / 回归）
                          └────────────────────────────────┘
                          /cc-nexs:hotfix       ← 旁路：bug 修复（绕开主流程）

/cc-nexs:approve-spec   ← G1 人工 gate 放行
/cc-nexs:approve-deploy ← G2 人工 gate 放行（部署确认后）
/cc-nexs:status         ← 只读状态查询
```

记住：`/cc-nexs:run` 是默认入口。其他单步命令**不会**自动推进 progress.md，只在调试或重跑某段时用。
