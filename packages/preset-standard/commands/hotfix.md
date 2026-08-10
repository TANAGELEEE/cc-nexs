---
description: "独立 Hotfix mini-Lean：latest-base worktree、本地验证、一次集中 Review、test 黑盒验收、人工 base 门禁。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task, Skill"
argument-hint: "<hotfix-id | bug 现象> [--level=P0|P1|P2|P3] [--related=<feature-id>] [--repos=a,b]"
---

# /cc-nexs:hotfix

Hotfix 是独立变更，不附着、复用或重开既有需求。参数若是已有 `mode=hotfix` id 就恢复它；若是 bug 描述，则本命令先按 `/cc-nexs:init "<描述>" --mode=hotfix --repos=...` 完成新编号、占号和 worktree 初始化，再继续。也可以显式分两步执行：

```text
/cc-nexs:init "<bug 现象>" --mode=hotfix --repos=<affected-repositories>
```

Git Custodian 必须从各仓库最新 `origin/<base_branch>` 创建 `.worktrees/<id>-<slug>/<repo>/` 和 `feature/<id>-<slug>`。`--related` 只写关联元数据，不能改变分支、worktree、candidate 或旧需求状态。

## 1. 分级与边界

按影响和紧急性判定，不按单一关键词静默判级：

| 级别 | 影响 / 紧急性 | 流程加码 |
|---|---|---|
| P0 | 正在发生的生产事故、资金/数据损坏、安全事件 | P1 全部要求 + 事故负责人和立即可执行回滚 |
| P1 | 关键流程不可用、多用户/核心数据受影响 | P2 + 受影响 AC 回归与回滚证明 |
| P2 | 局部行为缺陷、影响面可界定 | 本地验证 + 一次集中 Review + test 回归 |
| P3 | 单文件、总 changed lines ≤ 20、无行为/逻辑变化 | 机器边界证明后跳过模型 Review；仍做本地验证、test smoke 和 Gateway B |

显式 `--level` 只覆盖分级判断，不能绕过结构边界。任何 AC、API 契约、数据库 schema、权限模型变化或大范围重构，立即停止 Hotfix，另建 `lean`/`full` 需求。P3 最终 diff 不满足边界时升级 P2。

先填写唯一人工维护文档 `hotfix.md`，尤其是 `HOTFIX-SCOPE` 标记内字段；P0/P1 必填受影响 AC、回滚负责人和回滚步骤。然后运行确定性绑定：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs start-hotfix <id> [--level P2] [--related <feature-id>]
```

绑定后标记内任何变化都会 fail closed；不设额外 Gateway A，因为本命令及范围绑定本身就是 Hotfix 授权。

## 2. 执行状态机

```text
INIT --start-hotfix--> HOTFIX_IMPLEMENTING -> HOTFIX_IMPLEMENTED
  -> HOTFIX_LOCAL_VERIFYING
  -> P3: assert-hotfix-candidate
       -> PASS: HOTFIX_CANDIDATE_READY
       -> BLOCKED: HOTFIX_P3_BOUNDARY_BLOCKED -> HUMAN_INTERVENTION
  -> P0/P1/P2: HOTFIX_REVIEWING -> PARSE_HOTFIX_REVIEW
     -> PASS: HOTFIX_CANDIDATE_READY
     -> BLOCKED: HOTFIX_FIXING -> HOTFIX_LOCAL_REVERIFYING
                 -> HOTFIX_DELTA_REVIEW -> PASS/BLOCKED
  -> HOTFIX_TEST_RELEASE -> HOTFIX_TEST_VERIFYING
  -> HOTFIX_TEST_VERIFIED -> HOTFIX_RELEASE_PENDING_HUMAN
  -> /approve-release -> HOTFIX_BASE_MERGING -> COMPLETE
```

Review、test 或 Gateway B 实现意见导致修复时，整个 Hotfix 生命周期最多一次 delta Review；delta 再阻塞直接 `HUMAN_INTERVENTION`。不得回到无限 Review 循环。
Test 阻塞同时递增 `counters.fix_per_bug.HOTFIX_TEST`；Hotfix 模式阈值为 1，第一次失败允许唯一修复，第二次失败直接人工介入。P3 虽跳过模型 Review，也受同一 test 熔断约束。

Orchestrator 按 `progress.json.mode=hotfix` 调用 `nextStep`，并把 `workflow.hotfix.severity`、最新 test attempt/status 和 release approval 传入。角色固定为 `hotfix-developer`、`hotfix-reviewer`、`hotfix-verifier`，每次 Review/Verifier 必须独立 session。

## 3. 模型策略（三端一致）

角色 profile 默认：Developer=`balanced`、Reviewer=`review`、Verifier=`balanced`。绑定 scope 后，P0/P1 的 Reviewer 自动路由到 `escalated`，P2/P3 保持日常 profile。Claude Code 使用原生隔离 subagent；Codex 使用原生 agent；Pi 使用 package agent。

每次 dispatch 使用 `resolveRoleRuntime(preset, role, runtime, {models: mergedModels, featureConfig, progress: progressV2})`。Hotfix 风险只信已绑定的 `progress.hotfix.severity`：P0→critical、P1→high、P2→medium、P3→low。当前 routing 条件只含 mode/risk/severity，不能从自然语言可靠区分安全、资金、数据损坏；项目可以把全部 P0/P1 Developer 按 severity 升档，细分领域则在结构化 impact domain 落地前使用 feature `models.roles` 显式覆盖。feature profile 始终最终优先。

集中 Review 可选择不同模型，也可选择同一模型但更高 effort/thinking；硬约束是与实现 session 隔离。公共 `escalated` 只定义 `inherit + xhigh`，项目若希望真正切换到 Sol 或其他高能力模型，必须在私有 overlay/project config 中定义同名 profile。P0/P1 是否强制异构模型属于项目私有策略，不是公共 preset 的硬门槛。

## 4. 本地验证与构建优化

Git Custodian 先记录精确 code candidate，再执行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <id>
```

只允许调用项目配置的 `workflow.local_verify.driver`。driver 负责变更模块选择、依赖闭包、缓存、并行上限、build/start/smoke/E2E；不得在流程里写死 `npm build`、`mvn`、`main`、端口或某个 CLI。相同 candidate fingerprint 可复用已通过证据，candidate 改变会自动失效。

P3 本地验证通过后必须运行确定性边界控制器：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs assert-hotfix-candidate <id>
```

边界不满足时控制器写入 `HOTFIX_P3_BOUNDARY_BLOCKED` 并返回结构化原因，不以异常中断 Orchestrator。人工需要另建 P0/P1/P2 Hotfix，或改走 Lean/Full；禁止原地扩张已绑定 scope。

P0/P1/P2 本地通过后只做一次集中 Review：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --passed|--blocked [--finding "P0/P1 ..."]
```

修复后使用 `--closure`；不得第二次 closure。

## 5. Test 发布与独立验收

候选就绪后先进入 `HOTFIX_TEST_RELEASE`，再执行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <id> --hotfix --capability-attested [--retry]
```

控制器仅接受 `mode=hotfix + HOTFIX_TEST_RELEASE`，只把精确 feature candidate 合入配置的 `test_branch`，然后调用结构化 release driver。`--hotfix` 不再是绕过 readiness 的开关。CI 不可避免时只运行最终 candidate 的一次发布；日常反馈由本地 driver 提前消化。

发布成功后由独立 Hotfix Verifier 在新 `environment_revision` 上运行 BUG repro、受影响 AC/P0/P1 和必要冒烟，P3 也必须 smoke。将证据写入 `hotfix.md`，再绑定：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-test-verification <id> --passed|--blocked --evidence "<url/request/result>"
```

BLOCKED 回实现并消耗唯一 delta Review，再产生新 candidate、新 test attempt 和新环境回归。本地通过不能替代 test 验收。

## 6. Gateway B 与合并路径

Test 验收通过后停在 `HOTFIX_RELEASE_PENDING_HUMAN`，展示 scope hash、candidate commits、本地证据、Review/P3 skip 证明、test attempt/environment revision、回滚信息和 base targets。

人工意见使用 `/cc-nexs:request-release-changes`：

- `evidence`：只追加 `hotfix.md`，不失效 candidate/test，仍停 Gateway B。
- `implementation`：失效本地/Review/test 证明，进入 `HOTFIX_CHANGE_REQUESTED -> ... -> HOTFIX_DELTA_REVIEW -> HOTFIX_TEST_RELEASE`。
- `scope`：Hotfix 拒绝扩边，另建 Lean/Full 需求。

批准后：

```text
/cc-nexs:approve-release <id>
/cc-nexs:run <id>
```

确定性 base controller 只合并 Gateway B 批准且已在 test 验证的同一 feature candidate：

```text
latest base -> feature/<id>-<slug> -> test
                                  -> base (人工 Gateway B 后)
```

禁止 `test -> base`，禁止重新从 test 取 candidate，禁止 force push。base 在批准后变化则停止为 `HOTFIX_BASE_CHANGED`，同步最新 base 后重新本地验证、delta Review、test 验收和 Gateway B；不能悄悄 merge。

## 7. 完成条件

只有 `HOTFIX_BASE_MERGING -> COMPLETE` 且远端 ancestry 验证通过才完成。最后由 Git Custodian 合入只含 `hotfix.md/config.json/progress.md/progress.json` 的 docs candidate 并安全清理 worktree/feature ref。生产发布不属于本命令，始终由组织发布流程另行人工授权。
