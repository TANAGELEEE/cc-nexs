# 全流程时序与契约

本文档定义 `preset-standard` 的交付语义。`progress.json` v2 是权威状态；`progress.md` 只是人类可读镜像。

## 默认策略

新需求默认 `mode=lean`。完整链为：

```text
init -> plan -> PLAN_PENDING_HUMAN (Gateway A)
-> implement -> local executable checks (pass or structured deferred_to_test)
-> fast-track: test release/CI -> test verification -> one consolidated Review
-> standard: one consolidated Review -> test release/CI -> test verification
-> RELEASE_PENDING_HUMAN (Gateway B) -> configured base merge -> COMPLETE
```

Lean 只维护 `requirements.md` 和 `plan.md` 两份人工文档。每仓仍强制独立 worktree、`feature/<id>-<slug>` 与 immutable candidate ref。Gateway A 绑定 requirements + plan approval scope 的哈希，其中包括 `risk_tier`、`delivery_lane` 和每仓 `test_delivery.<repo>: deploy|local`；Gateway B 绑定本地验证、Review 和 test 验收共享的精确 fingerprint。`fast-track` 只允许 low/medium，旧计划缺 lane 时安全解释为 standard。

集中 Review 使用独立 session，可选择不同模型，也可用相同模型但提升 effort/thinking。Lean 计划只派一个 Planner；high/critical 只升级后续 Reviewer 并建议 Full，不会冷启动第二个 Planner。Hotfix P0/P1 自动路由 Reviewer。feature 显式 profile 最终优先。只把 P0/P1 视为阻塞；修复后最多一次 delta closure，再失败转人工。

Gateway B 若提出意见，必须结构化分类：证据补充留在门禁；批准范围内实现修改走同一 feature worktree、本地重验、一次 Gateway B delta Review、新 test attempt 和回归；需求/AC/方案边界变化使 Gateway A 哈希失效并返回 Planner。旧 candidate 与 test attempt 只保留为历史，不能继续授权 base merge。

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
- `--no-auto-test-release` 或 feature `release.test=manual` 显式退出自动 test 发布；Lean/Hotfix 中这是把后续发布完全交给外部流程，G2 本身不会伪造 immutable release attempt，也不能直接恢复 Gateway B。要回到 cc-nexs 验收必须配置 driver 并恢复 `auto_if_ready`。
- test environment、deploy target、candidate 或 release driver 不足时才在 push 前停止；浏览器、登录会话和验收 URL 只影响部署后的 verification。
- Lean 的主分支合并由 Gateway B 显式授权；fast/full 的生产/主分支合并仍保持旧的人工授权语义。

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
| KICKOFF | 多仓 Tech Lead + QA 并行 | ownership wave 实现、每仓 build/test、Sprint 用例 | SA 测试用例评审 |
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

进入 `TEST_RELEASE` 后，自动路径在远端 mutation 前只检查：

1. 每个 `deploy` 代码仓存在 `test_branch`，所有 deploy/local candidate ref 都可解析为不可变 SHA。
2. 项目配置结构化 `release.test.driver`。
3. environment 明确为 test，配置 URL 不指向 production。
4. 配置、Markdown、memory 和 Git 中没有明文 password/token；仅允许 opaque `credential_ref`。

缺 `test_branch` 不会自动推断为 local；只有 Gateway A 已绑定 `test_delivery.<repo>: local` 才不 push 该仓。local candidate 仍进入完整 fingerprint，并必须保持 exact clean worktree。

运行时浏览器能力：

| Runtime | Provider |
|---|---|
| Claude Code | `chrome-devtools-mcp` |
| Codex | 当前 in-app/Chrome 登录会话 |
| Pi | 优先 ego lite（隔离 task Space）；不可用时 `@injaneity/pi-computer-use@0.4.3`（`headless: true`） |

浏览器、登录/MFA、`app_url` / `operations_url`、allowlist、S3 bucket/CORS/IAM 的可观测行为都在部署后检查。缺能力不会阻止 test merge；部署成功后记录 `manual_required` 并进入可恢复的 `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`。

自动控制器按 `release_order`：

1. fetch 最新 `origin/<test_branch>`；
2. 在临时 detached worktree `--no-ff` 合并 candidate；
3. 普通 non-force push；
4. 再 fetch 并证明远端包含 source/integration SHA；
5. 调 release driver start；若 CI/CD 尚未完成，返回 `pending + pipeline` 并持久化 `deploying`；
6. 后续 `release-test --resume` 只轮询同一 attempt，不重复 merge/push/触发 pipeline；
7. 在 `delivery.test.attempts[]` 记录 integration、pipeline、deployment 和 environment_revision。

任一仓失败时保留已完成证据并停止。进入 release-blocked 后仅显式 `--retry` 会恢复并从最新远端 tip 创建新 attempt，已包含 candidate 的仓库幂等跳过；`deploying` 期间 candidate 被冻结，只能 `--resume` 同一 pipeline，不能重试或换 candidate。

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

Fast/Full 的 spec 在 G1 前固定 `IMPLEMENTATION-OWNERSHIP`。同一 Wave 的不同 assigned repository/worktree 会真正并行；同一 repository 始终串行。整批先冻结模型路由，所有 worker join 后再做每仓聚合验证、每仓一个 candidate。Fast 的共享 dev-plan/api-doc/deploy 由 join 后唯一 Fullstack 同步；Full 保留独立 DOC_SYNC。Claude Task、Codex native agents 都必须先启动完整 wave 再等待；Pi 使用一次 `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` 和一次 `subagent_wait` 实现同一 barrier。

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

Hotfix 是独立 `mode=hotfix` 的 mini-Lean：从各仓最新 base 创建自己的 `feature/<id>-<slug>` 与 worktree，只维护 `hotfix.md` 和机器状态。关联旧需求只是元数据。

```text
scope bind -> implement -> local verify -> one Review (P3 machine skip)
-> exact candidate -> test -> independent black-box verify
-> HOTFIX_RELEASE_PENDING_HUMAN -> exact candidate -> base
```

P0/P1/P2 只做一次集中 Review；任何修复全生命周期只允许一次 delta Review。P3 仅在单文件、changed lines ≤ 20、无行为变化的确定性证明后跳过模型 Review，但仍须 test smoke。契约/schema/权限或大重构直接转新 Lean/Full 需求。Gateway B 的 evidence 意见只补文档，implementation 意见走唯一 delta + 新 test，scope 意见拒绝扩边。禁止从 test 合并 base；两条合并都使用同一 feature candidate。生产发布仍人工。

## Gate 与停止条件

- Lean Gateway A：批准 requirements 与 plan scope。
- Lean Gateway B：批准已本地验证、集中 Review 且 test 验收通过的 exact fingerprint。
- Lean Gateway B change request：`evidence` 不改 candidate；`implementation` 走有界 delta；`scope` 返回 Gateway A。
- G1：spec 评审 PASS 后唯一固定人工产品决策点。
- G2：仅用于显式 manual policy 或真正的 test delivery 阻断；浏览器/登录/URL 缺失不再回退 G2。legacy per_sprint 保留旧含义。
- `TEST_RELEASE_BLOCKED`：test merge/push/driver 失败。
- `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`：driver 已部署但自动环境验证不能完成。
- 熔断：review/fix/evaluator 达阈值。

熔断计数是当前循环的连续失败次数：对应 review/acceptance PASS 后清零，BUG 部署后验证为 VERIFIED 后清除该 BUG 的 fix 计数。状态机只在对应失败/重试状态检查熔断，历史高计数不会劫持 TEST_RELEASE、其他阶段或 COMPLETE。

Gate 只暂停 cc-nexs 角色派发，不安装全局工具锁。

## 完成定义

Fast/full 的 `COMPLETE` 表示完整 test 交付、部署后 QA 和最终契约验收通过。Lean 只有 Gateway B 明确授权后才进入 base merge；它仍不自动授权生产部署。

Legacy 模式不自动授权：

- 合并 main/master；
- 生产发布；
- 删除远端 feature；
- 清理 worktree。

这些操作继续由用户显式授权 Git Custodian/发布系统执行。
