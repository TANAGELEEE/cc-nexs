# {编号} {需求短名} 进度

> 本文件是 `progress.json` v2 的人类可读镜像，由 orchestrator 刷新。权威状态、gate、计数器和事件只在 progress.json；禁止任何角色直接修改两者。

## 当前状态

```yaml
current_state: INIT
updated_at: null
```

## 状态机字典

> 状态分三套：lean 是新需求默认，full 可按多个 Sprint 开发，fast 固定单 Sprint。
> 由 progress.json.mode 决定走哪一套，并要求与 config.json.mode 一致。

### lean 模式（mode=lean，默认）

| 状态 | 含义 |
|---|---|
| INIT / PLANNING | Lean Planner 维护 requirements.md 与 plan.md |
| **PLAN_PENDING_HUMAN** | ⏸️ Gateway A，批准 requirements + plan scope 哈希 |
| PLAN_APPROVED / IMPLEMENTING | 按路径所有权在每仓 feature worktree 实现 |
| LOCAL_VERIFYING | 确定性 driver 执行 build/start/smoke/e2e |
| CONSOLIDATED_REVIEW | 独立 Reviewer 一次性审全部累计 diff，只阻塞 P0/P1 |
| REVIEW_FIXING / LOCAL_REVERIFYING / REVIEW_CLOSURE | 阻塞项修复、本地复验、最多一次 delta closure |
| CANDIDATE_READY / TEST_RELEASE | 精确 candidate 合入 test 并发布 |
| TEST_VERIFYING / TEST_FIXING | test 黑盒验收；失败后完整修复闭环 |
| TEST_VERIFIED | test 环境全部必要 AC 通过 |
| **RELEASE_PENDING_HUMAN** | ⏸️ Gateway B，批准 reviewed + test-verified fingerprint |
| GATEWAY_B_CHANGE_REQUESTED / FIXING / LOCAL_REVERIFYING / DELTA_REVIEW | Gateway B 范围内意见的单次增量修复闭环 |
| SCOPE_CHANGE_REQUESTED | Gateway B 改变需求/AC/方案边界，返回 Planner 与 Gateway A |
| BASE_MERGING | Git Custodian non-force 合入配置 base，docs 最后 |
| COMPLETE | base 集成与清理完成 |
| HUMAN_INTERVENTION / *_BLOCKED | delta Review、发布或分支保护需要人工处理 |

### full 模式（mode=full）

| 状态 | 含义 |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已写，待 Planner 展开 spec |
| SPEC_DRAFTED | spec.md 已写，待 SA 评审 |
| SPEC_REVIEWING | SA 在评审 spec |
| SPEC_NEEDS_REVISION | SA 评审未通过，回 Planner 修订 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等当前运行时的 approve-spec 入口 |
| SPEC_APPROVED | 人工放行，进入 Sprint 循环 |
| SPRINT_<N>_KICKOFF | Sprint N 启动 |
| SPRINT_<N>_QA_CASES | QA 在写 Sprint N 测试用例 |
| SPRINT_<N>_DEV | Tech Lead 在写 Sprint N 代码 |
| SPRINT_<N>_SA_TEST_REVIEW | SA 在审 Sprint N 测试用例 |
| SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION | SA 打回测试用例，待 QA 修订后重新评审 |
| SPRINT_<N>_DOC_SYNC | Tech Lead 同步 deploy.md / api-doc.md |
| SPRINT_<N>_DOC_SYNC_DONE | Sprint 文档同步完成，待代码评审 |
| SPRINT_<N>_SA_CODE | SA 在评审 Sprint N 代码 |
| SPRINT_<N>_FIX / FIX_DONE | 修复 Sprint 评审项并重新评审 |
| SPRINT_<N>_DEV_DONE | Sprint N 开发闭环完成；不部署、不验收 |
| ALL_SPRINTS_DEV_DONE | 全部 Sprint 开发完成 |
| INTEGRATION_REVIEW | 完整 candidate 跨 Sprint/跨仓评审 |
| INTEGRATION_FIX | 集成修订完成，待重新评审 |
| TEST_RELEASE | 完整需求合入 test + 发布；默认 auto_if_ready |
| TEST_RELEASE_BLOCKED | test 合并/driver/发布失败，停止处理 |
| TEST_DEPLOYED_NEEDS_MANUAL_VERIFY | 已部署但自动环境验证不能完成 |
| FINAL_QA | QA 在已部署 test 环境执行累计用例 |
| FINAL_QA_BLOCKED | 部署后测试发现问题 |
| FINAL_FIX / FINAL_FIX_REVIEW | 修复、独立复审，之后必须重新 TEST_RELEASE |
| SPRINT_<N>_TECH_LEAD_REVIEW | 🛑 熔断：同 BUG 修 3 次升级 |
| FINAL_EVAL | Evaluator 最终全量打分 |
| COMPLETE | 全部通过，feature 分支可合并 |

`SPRINT_<N>_DEPLOY_GATE / QA_RUN / QA_REGRESSION / EVAL / DONE / ALL_SPRINTS_DONE` 仅用于没有 `delivery` 字段的 legacy `per_sprint` 需求。

### fast 模式（mode=fast，单 sprint 三角色合并）

| 状态 | 含义 |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已写，待 Fullstack 展开 spec |
| SPEC_DRAFTED | spec.md 已写，待 Reviewer 评审 |
| SPEC_REVIEWING | Reviewer 在评审 spec |
| SPEC_NEEDS_REVISION | Reviewer 评审未通过，回 Fullstack 修订 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等当前运行时的 approve-spec 入口 |
| SPEC_APPROVED | 人工放行，进入实现阶段 |
| BUILD | Fullstack 在写代码 + 同步 dev-plan/api-doc/deploy |
| CODE_REVIEW | Reviewer 评审代码（仅 sa-code-review.md） |
| CODE_REVIEW_NEEDS_REVISION | 代码评审未通过，回 Fullstack 修 |
| TEST_RELEASE | 完整 candidate 默认自动发布 test；能力不足时在此回退人工 G2 |
| TEST | Verifier 一次产 test-cases.md + test-report.md（initial） |
| TEST_BLOCKED | Verifier 报阻塞，进入修复 |
| FIX | Fullstack 在修指定 BUG |
| FIX_REVIEW | Reviewer 评审修复 candidate；PASS 后重新 TEST_RELEASE |
| REGRESSION | 新 test 部署后 Verifier 回归（重跑 BUG repro + sprint P0/P1） |
| TEST_PASSED | Verifier 通过，进入契约验收 |
| ACCEPTANCE | Reviewer 产 acceptance.md（此时 test-report.md 已就绪） |
| ACCEPTANCE_REJECTED | 契约验收未通过，回 BUILD |
| HUMAN_INTERVENTION | 🛑 熔断：同 BUG 修 ≥2 次，停下要人工 |
| COMPLETE | 全部通过，feature 分支可合并 |

## 计数器

```yaml
review_revision: 0              # 当前 review 循环连续 NEEDS_REVISION 次数；PASS 后清零
fix_per_bug: {}                 # 同一 BUG 连续部署回归失败次数；VERIFIED 后清除
evaluator_reject: 0             # 当前 acceptance 循环连续拒绝次数；PASS 后清零
```

## 熔断阈值

```yaml
review_revision: 3              # 当前 review 循环连续 ≥3 次升级回 SPEC_REVIEWING
fix_per_bug: 3                  # 同 BUG 连续 ≥3 次升级到 TECH_LEAD_REVIEW
evaluator_reject: 2             # 当前 acceptance 循环连续 ≥2 次升级回 spec
```

## Sprint 进度

```yaml
total_sprints: 0                # Planner 展开 spec 时填
current_sprint: 0
sprint_status:
  # M1: not_started | in_progress | done
```

## 人工 gate

### G1: Spec 审批

```yaml
human_approved_at: null
human_approver: null
spec_summary_for_human: null    # orchestrator 在 SPEC_PENDING_HUMAN 时填
```

### G2: 手工 test 发布确认（仅显式退出或前置能力不足）

```yaml
g2_approved: false              # final_only/fast 的完整需求手工发布确认
# legacy full per-sprint 标记：
# g2_sprint_1_approved: true
# g2_sprint_2_approved: true
g2_approved_at: null
g2_approver: null
```

## 历史轨迹

<!-- 每次状态转移由 orchestrator append 一行 -->
<!-- 格式：- <ISO8601> <prev_state> → <next_state>  原因 -->

- (尚无)

## 待人工接入

<!-- 物理不可为的项追加在这里，不阻塞流程 -->
<!-- 例如：生产部署 / 真机 UI 验证 / 业务口径确认 -->

- (尚无)
