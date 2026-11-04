# 计划 — {编号}.{需求短名}

> 本文件是 Lean 模式唯一计划、Review 与验证摘要。详细运行日志保留在本地临时目录，不粘贴到此文件。

<!-- APPROVAL-SCOPE START -->

## 现状与边界

- 可复用实现：
- 影响仓库/模块：
- 非目标：

## 技术方案

- 核心设计：
- 前后端/API 契约：
- 数据库与配置：
- 兼容与回滚：

## 任务与并行波次

| Task | AC | 仓库 | 允许修改路径 | 依赖 | 验证 | 波次 |
|---|---|---|---|---|---|---|
| T-001 | AC-001 |  |  | 无 |  | W1 |

## 交付策略

- delivery_lane: pending
- Fast-track 资格：复用既有能力 / 无新增表结构或迁移 / 无新增基础设施与密钥 / 无公开破坏性契约 / 风险为 low 或 medium
- 不满足项与理由：

## Test 交付拓扑

每个代码仓必须保留一条机器可解析的策略行；`deploy` 必须配置 `test_branch`，`local` 仅用于从精确 candidate worktree 本地启动并连接已部署的 test 服务。

- test_delivery.<repo-id>: deploy / local

| 仓库 | Candidate 去向 | 验证方式 |
|---|---|---|
|  | test_branch / local | 部署到 test / 本地启动并连接 test 后端 |

## 本地验证矩阵

| Check | AC | 类型 | 命令/Driver | 通过条件 | 无法本地执行时的 Test 动作 |
|---|---|---|---|---|---|
| LV-001 | AC-001 | lint/typecheck/targeted test/browser |  |  |  |

本地验证只做部署前的快速回馈，主要验收在 test 环境。前端跑 lint、类型检查和定向测试，受影响页面用 `browser: <启动命令> @ <页面路径>` 行做浏览器验证；后端跑定向测试。完整生产构建由 CI 执行，仅当改动构建配置、依赖、lockfile、路由生成或发布流程时才放入矩阵。若 test 环境放宽了生产校验（严格构建、发布或翻译校验），把受影响范围的生产严格命令放入此矩阵：test 无法证明它。

## Test 环境验收矩阵

| Check | AC | 环境动作 | 通过条件 |
|---|---|---|---|
| TV-001 | AC-001 |  |  |

## 基线与末端取样

- 基线快检（在 base 实跑快速检查与依赖安装干跑；已有失败及需要的决定）：
- 末端消费者（索引、采集、流水线、批处理等；没有则写“无”）：
- 准入条件与真实取样结果（基于当前来源与实际输出，不发布）：

## 预授权 Test 操作

- Test 环境操作（动作、目标、回滚；Gateway A 后不再询问）：
- Test 整合策略（衍生路径，每条写重新生成命令，或在 Test 不使用候选值时写“保留 Test 侧”；没有则写“无”）：
- derived_binding: each-candidate / before-final-test（保留其一；before-final-test 表示衍生路径在源码通过 Test 前保持 base 值，通过后一次生成并做最后一轮 Test）

## 风险与发布

- risk_tier: pending
- 风险判断依据：
- 集中 Review 关注点：
- 发布顺序：
- 回滚方案：

## 复杂度与规模

- 复杂度：low / medium / high
- 高风险项：无 / 多模块高耦合 / 公开契约破坏 / 权限或资金高风险 / 破坏性迁移 / 其他
- 规模建议：保持单个 Lean 需求 / 拆分为多个 Lean 需求
- 判断依据：

<!-- APPROVAL-SCOPE END -->

## 计划审核

- 审核方式：skipped（low/medium，由人在 Gateway A 审）/ 独立事实核查（high/critical）
- 计划来源：Planner 起草 / 用户 plan mode（--from）
- 审核轮次：
- P0/P1 阻塞项：
- 非阻塞建议：
- 计划审核结论：待执行

## 执行状态

| Task | 状态 | 修改路径 | Candidate | 备注 |
|---|---|---|---|---|

## 本地验证记录

| Attempt | Candidate fingerprint | 结果 | 证据摘要 |
|---|---|---|---|

## 集中 Review

- Reviewed fingerprint：
- Finder 视角：
- 阻塞项（实际跑出并经 Judge 复跑确认的 P0/P1）：
- 未证实项（交给 test 验收的 probe）：
- P2/P3、已驳回与格式不合格项：
- 结论：待执行

<!-- Judge 在本段结尾写入唯一的 `cc-nexs-review` 区块，格式见 rules/review-findings.md -->

## Review 闭环

- 复跑的问题编号：
- Delta fingerprint：
- 结论：待执行

<!-- 闭环同样以 `cc-nexs-review` 区块结尾，round 为 closure -->

## Test 环境验收

| Attempt | Environment revision | AC 覆盖 | 结果 | 证据摘要 |
|---|---|---|---|---|

## 最终 AC 覆盖

| AC-ID | 本地证据 | Test 证据 | 结果 |
|---|---|---|---|

## 上线后事项

base 合并后、本次发布不执行的步骤（生产部署、数据或索引重建、通知等）。每步写一行 `- [ ] 步骤`，没有则写“无”；完成后勾选。`cc-nexs status` 会列出未完成项。

## 计划变更

| 日期 | 变更 | 是否影响批准范围 | 处理 |
|---|---|---|---|

## Gateway B 变更请求

| ID | 类型 | 提出人 | 影响 AC | 允许修改路径 | 意见 | 状态 |
|---|---|---|---|---|---|---|
