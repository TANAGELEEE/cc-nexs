# BUG {编号} · {需求短名}

## Bug 与影响

- 现象：
- 影响对象/环境：
- 复现方式：
- 紧急性：
- 根因：
- 为什么原测试未发现：

## 绑定范围

填写实际路径和验证命令后绑定。范围、分级或命令调整使用 `revise-hotfix` 记录已有用户授权；契约/schema/权限扩展使用 `--promote-lean`，在原 BUG 旁升级为 Lean 并重新经过 Gateway A。

<!-- HOTFIX-SCOPE START -->
- severity: P2
- related_feature: -
- intended_paths: -
- affected_acs: -
- rollback_owner: -
- rollback_steps: -
- acceptance_contract_change: no
- api_contract_change: no
- database_schema_change: no
- permission_model_change: no
- broad_refactor: no
- non_behavioral_change: no

### 本地验证矩阵

| Check | 仓库 | 命令/Driver | 预期结果 |
|---|---|---|---|
<!-- HOTFIX-SCOPE END -->

`intended_paths` 填写逗号分隔的 `repo-id/path`；P0/P1 必须填写受影响 AC、回滚负责人和步骤。矩阵每行填写唯一 Check ID 和实际命令，至少覆盖必要复现与回归检查；不要用说明文字或占位命令代替。

## 实现与回滚

- 修复方案：
- 影响调用面：
- 回滚验证证据：

## 本地验证

使用配置的 driver，或在无 driver 时执行绑定矩阵内的命令并登记 `check/command/exit_code/proof/result`。证据绑定精确 candidate，Hotfix 不允许延期到 test。

## 集中 Review

P0/P1/P2/P3 均需独立 Review。文件数和变更行数仅作风险参考，不能证明没有行为变化。记录候选、阻塞项和修复 delta 的结论。

## Test 环境验收

- candidate fingerprint：
- test attempt / environment revision：
- BUG repro：
- 受影响 AC / P0/P1：
- 冒烟：
- 结论：
- 环境限制与未完成验证：

## Gateway B 变更请求

| ID | 类型 | 提出人 | 允许修改路径 | 意见 | 状态 |
|---|---|---|---|---|---|

## 发布摘要

- test 目标：配置的 `test_branch`
- base 目标：配置的 `base_branch`
- 精确 candidate：
- 人工批准：
- 环境例外授权与回滚证据（如适用）：

环境例外仅授权配置 base 集成；test 未通过的事实保留，不默认授权生产部署。
