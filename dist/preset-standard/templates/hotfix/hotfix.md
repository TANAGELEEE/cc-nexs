# Hotfix {编号} · {需求短名}

## Bug 与影响

- 现象：
- 影响对象/环境：
- 复现方式：
- 紧急性：
- 根因：
- 为什么原测试未发现：

## 绑定范围

以下标记内是不可静默扩大的授权边界。任一契约/数据库/权限变化或大范围重构必须停止 hotfix，另建 `lean` 或 `full` 需求。

<!-- HOTFIX-SCOPE START -->
- severity: P2
- related_feature: -
- intended_paths: -
- acceptance_contract_change: no
- api_contract_change: no
- database_schema_change: no
- permission_model_change: no
- broad_refactor: no
- non_behavioral_change: no
<!-- HOTFIX-SCOPE END -->

## 实现与回滚

- 修复方案：
- 影响调用面：
- P0/P1 回滚负责人：
- P0/P1 回滚步骤：

## 本地验证

由配置的 `workflow.local_verify.driver` 记录 build/start/smoke/E2E 证据。不得硬编码 `npm build`、`mvn`、模块名或端口。

## 集中 Review

P2/P1/P0 只做一次独立集中 Review；阻塞后只允许一次 delta Review。P3 仅在单文件、变更行数不超过 20 且无行为变化的机器边界证明后跳过模型 Review。

## Test 环境验收

- candidate fingerprint：
- test attempt / environment revision：
- BUG repro：
- 受影响 AC / P0/P1：
- 冒烟：
- 结论：

## Gateway B 变更请求

| ID | 类型 | 提出人 | 允许修改路径 | 意见 | 状态 |
|---|---|---|---|---|---|

## 发布摘要

- test 目标：配置的 `test_branch`
- base 目标：配置的 `base_branch`
- 精确 candidate：
- 人工批准：
