# 全流程时序与契约

本文档定义 `preset-standard` 的交付语义。`progress.json` v2 是权威状态；`progress.md` 只是人类可读镜像。

## 默认策略

新需求初始化为：

```yaml
workflow:
  sprint_delivery: final_only
  test_release:
    policy: auto_if_ready
    on_prerequisite_failure: manual_gate
```

含义：

- Sprint 只负责开发、项目本地验证、测试用例和代码评审。
- Sprint 完成不合入 test、不发布、不做验收打分。
- 所有 Sprint 开发完成后，完整 candidate 只做一次集成评审、test 发布和最终验收。
- `--no-auto-test-release` 或 feature `release.test=manual` 显式退出自动 test 发布。
- driver、test branch、浏览器、登录会话或安全前置不足时，在任何 push 前回退人工 G2。
- 生产发布和主分支合并始终人工，不受 test 自动化策略影响。

没有 `delivery` 字段的旧 progress 固定解释为 `per_sprint + manual`。升级插件不能给历史需求自动增加远端写权限。

## Full 状态主链

```text
INIT -> REQ_DRAFTED -> RECON_DONE -> SPEC_DRAFTED -> SPEC_REVIEWING
     -> SPEC_PENDING_HUMAN (G1) -> SPEC_APPROVED

     -> SPRINT_1_KICKOFF -> DEV + QA_CASES -> SA_TEST_REVIEW
     -> DOC_SYNC -> SA_CODE -> SPRINT_1_DEV_DONE
     -> ...
     -> SPRINT_N_DEV_DONE -> ALL_SPRINTS_DEV_DONE

     -> INTEGRATION_REVIEW -> TEST_RELEASE
     -> FINAL_QA -> FINAL_EVAL -> COMPLETE
```

### Sprint 契约

| 阶段 | 执行角色 | 必要产物 | PASS 后 |
|---|---|---|---|
| KICKOFF | Tech Lead + QA 并行 | 实现、本地 build/test、Sprint 用例 | SA 测试用例评审 |
| SA_TEST_REVIEW | SA | `sa-test-review.md` 新轮次 | Tech Lead 同步 docs |
| DOC_SYNC | Tech Lead | `api-doc.md`、`deploy.md` Sprint 章节 | SA 代码评审 |
| SA_CODE | SA | `sa-code-review.md` 新轮次 | `SPRINT_<N>_DEV_DONE` |
| DEV_DONE | Orchestrator | candidate ref 与精确路径 | 下一 Sprint 或集成评审 |

SA_CODE 的 `NEEDS_REVISION` 必须经过：

```text
SPRINT_<N>_FIX -> Tech Lead revise_implementation
-> SPRINT_<N>_FIX_DONE -> fresh SA code review
```

旧 SA 结论不能在修复后复用。

测试用例评审的 `NEEDS_REVISION` 必须经过：

```text
SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION
-> QA revise_cases -> SPRINT_<N>_QA_CASES
-> fresh SPRINT_<N>_SA_TEST_REVIEW
```

`DOC_SYNC` 在 `final_only` 和 legacy `per_sprint` 中都显式派发 Tech Lead `sync_docs`，完成后才进入代码评审。

## 完整需求集成评审

`ALL_SPRINTS_DEV_DONE` 后，SA 一次性评审：

- 全部 AC 与 Sprint 累计实现；
- 所有代码仓 base...candidate diff；
- 前后端/跨仓 API 契约；
- DB、配置、发布顺序和回滚；
- 跨 Sprint 组合路径与累计测试覆盖。

`NEEDS_REVISION` 路径：

```text
INTEGRATION_REVIEW_NEEDS_REVISION
-> Tech Lead revise_integration
-> INTEGRATION_FIX
-> fresh INTEGRATION_REVIEW
```

需要改 AC 时必须回 Planner 和 G1，Tech Lead 不得自行修改契约。

## Test release

集成评审 PASS 后进入 `TEST_RELEASE`。自动路径在远端 mutation 前检查：

1. 每个代码仓存在 `test_branch`，candidate ref 可解析为不可变 SHA。
2. 项目配置结构化 `release.test.driver`。
3. `app_url` / `operations_url` 使用 test host、HTTPS，并位于 `allowed_hosts`。
4. 当前 runtime 浏览器能力可用并能证明 test 会话已登录。
5. 配置、Markdown、memory 和 Git 中没有明文 password/token；仅允许 opaque `credential_ref`。

运行时浏览器能力：

| Runtime | Provider |
|---|---|
| Claude Code | `chrome-devtools-mcp` |
| Codex | 当前 in-app/Chrome 登录会话 |
| Pi | `@injaneity/pi-computer-use@0.4.3` |

前置失败不 push，状态留在 `TEST_RELEASE` 并输出人工 G2。人工确认代表完整 candidate 已合入 test、发布并完成必要环境检查。

自动控制器按 `release_order`：

1. fetch 最新 `origin/<test_branch>`；
2. 在临时 detached worktree `--no-ff` 合并 candidate；
3. 普通 non-force push；
4. 再 fetch 并证明远端包含 source/integration SHA；
5. 调 release driver；
6. 在 `delivery.test.attempts[]` 记录 integration、pipeline、deployment 和 environment_revision。

任一仓失败时保留已完成证据并停止。重试从最新远端 tip 开始，已包含 candidate 的仓库幂等跳过。

## 最终 QA 与验收

首次 test release 成功后，QA `final` 执行所有 Sprint 累计 P0/P1、跨 Sprint 集成路径和必要 UI/运维台检查。

通过条件：

- 报告绑定当前 release attempt 和 environment_revision；
- 必需 P0/P1 全部执行并通过；
- 没有 OPEN/FIXED BUG；
- `test-report.md` 末尾 `结论: 通过`。

必需用例不能以“待人工接入”冒充通过。生产专属/可选项可以作为遗留风险列出。

QA PASS 后 Evaluator 只做一次 `scope=final` 全量 AC 打分。新流程不要求逐 Sprint acceptance 章节。

## 部署验收失败循环

```text
FINAL_QA_BLOCKED
-> FINAL_FIX                 Tech Lead，本地验证只到 FIXED
-> FINAL_FIX_REVIEW          独立 SA/Reviewer 新轮次
-> TEST_RELEASE              新 candidate 重新发布
-> FINAL_QA                  final-regression，新 environment_revision
-> FINAL_EVAL
```

只有部署后的 `final-regression` 可把 BUG 从 `FIXED` 改为 `VERIFIED`。修复评审 `NEEDS_REVISION` 进入 `FINAL_FIX_REVIEW_NEEDS_REVISION`，先重新实现再复审。

最终验收未通过进入 integration 修订、复审、重新发布和回归，不能直接把状态改成 COMPLETE。

## Fast 模式

Fast 固定单 Sprint，但交付语义相同：

```text
SPEC_APPROVED -> BUILD -> CODE_REVIEW -> TEST_RELEASE
-> TEST -> TEST_PASSED -> ACCEPTANCE -> COMPLETE
```

失败循环：

```text
TEST_BLOCKED -> FIX -> FIX_REVIEW -> TEST_RELEASE -> REGRESSION
```

每轮 FIX 都必须产生新 candidate 和新 Reviewer 结论。release attempt > 1 时必须用 regression，不能重新伪装为 initial。

## Hotfix

P0/P1/P2/P3 保留分档与简化评审，但交付统一：candidate -> `/cc-nexs:release-test --hotfix` -> 独立部署后回归。P0/P1 再做受影响 AC 局部验收。显式退出或前置不足时只输出人工 test handoff；生产发布仍人工。

## Gate 与停止条件

- G1：spec 评审 PASS 后唯一固定人工产品决策点。
- G2：自动 test 发布显式退出或前置不足时的 fallback；legacy per_sprint 保留旧含义。
- `TEST_RELEASE_BLOCKED`：test merge/push/driver 失败。
- `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`：driver 已部署但自动环境验证不能完成。
- 熔断：review/fix/evaluator 达阈值。

熔断计数是当前循环的连续失败次数：对应 review/acceptance PASS 后清零，BUG 部署后验证为 VERIFIED 后清除该 BUG 的 fix 计数。状态机只在对应失败/重试状态检查熔断，历史高计数不会劫持 TEST_RELEASE、其他阶段或 COMPLETE。

Gate 只暂停 cc-nexs 角色派发，不安装全局工具锁。

## 完成定义

`COMPLETE` 表示完整 test 交付、部署后 QA 和最终契约验收通过。它不自动授权：

- 合并 main/master；
- 生产发布；
- 删除远端 feature；
- 清理 worktree。

这些操作继续由用户显式授权 Git Custodian/发布系统执行。
