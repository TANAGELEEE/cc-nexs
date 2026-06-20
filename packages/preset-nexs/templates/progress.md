# {编号} {需求短名} 进度

> 本文件由 cc-nexs orchestrator 维护。除人工 gate 放行外，**禁止其他角色直接修改**。

## 当前状态

```yaml
current_state: INIT
updated_at: null
```

## 状态机字典

> 状态分两套：full 模式按 SPRINT 循环，fast 模式单 sprint 直跑到底。
> 由 config.json.mode 决定走哪一套。

### full 模式（mode=full）

| 状态 | 含义 |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已写，待 Planner 展开 spec |
| SPEC_DRAFTED | spec.md 已写，待 SA 评审 |
| SPEC_REVIEWING | SA 在评审 spec |
| SPEC_NEEDS_REVISION | SA 评审未通过，回 Planner 修订 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等 `/cc-nexs:approve-spec` |
| SPEC_APPROVED | 人工放行，进入 Sprint 循环 |
| SPRINT_<N>_KICKOFF | Sprint N 启动 |
| SPRINT_<N>_QA_CASES | QA 在写 Sprint N 测试用例 |
| SPRINT_<N>_DEV | Tech Lead 在写 Sprint N 代码 |
| SPRINT_<N>_SA_TEST_REVIEW | SA 在审 Sprint N 测试用例 |
| SPRINT_<N>_DOC_SYNC | Tech Lead 同步 deploy.md / api-doc.md |
| SPRINT_<N>_SA_CODE | SA 在评审 Sprint N 代码 |
| **SPRINT_<N>_DEPLOY_GATE** | ⏸️ 人工 gate G2，等 `/cc-nexs:approve-deploy` |
| SPRINT_<N>_QA_RUN | QA 执行 Sprint N 用例 |
| SPRINT_<N>_FIX | Tech Lead 修 Sprint N bug |
| SPRINT_<N>_QA_REGRESSION | QA 回归 Sprint N |
| SPRINT_<N>_EVAL | Evaluator 按 AC 打分 |
| SPRINT_<N>_DONE | Sprint N 通过 |
| SPRINT_<N>_TECH_LEAD_REVIEW | 🛑 熔断：同 BUG 修 3 次升级 |
| ALL_SPRINTS_DONE | 所有 sprint 完成，待最终验收 |
| FINAL_EVAL | Evaluator 最终全量打分 |
| COMPLETE | 全部通过，feature 分支可合并 |

### fast 模式（mode=fast，单 sprint 三角色合并）

| 状态 | 含义 |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已写，待 Fullstack 展开 spec |
| SPEC_DRAFTED | spec.md 已写，待 Reviewer 评审 |
| SPEC_REVIEWING | Reviewer 在评审 spec |
| SPEC_NEEDS_REVISION | Reviewer 评审未通过，回 Fullstack 修订 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等 `/cc-nexs:approve-spec` |
| SPEC_APPROVED | 人工放行，进入实现阶段 |
| BUILD | Fullstack 在写代码 + 同步 dev-plan/api-doc/deploy |
| CODE_REVIEW | Reviewer 评审代码（仅 sa-code-review.md） |
| CODE_REVIEW_NEEDS_REVISION | 代码评审未通过，回 Fullstack 修 |
| **DEPLOY_GATE** | ⏸️ 人工 gate G2，等 `/cc-nexs:approve-deploy` |
| TEST | Verifier 一次产 test-cases.md + test-report.md（initial） |
| TEST_BLOCKED | Verifier 报阻塞，进入修复 |
| FIX | Fullstack 在修指定 BUG |
| REGRESSION | Verifier 在回归（重跑 BUG repro + sprint P0/P1） |
| TEST_PASSED | Verifier 通过，进入契约验收 |
| ACCEPTANCE | Reviewer 产 acceptance.md（此时 test-report.md 已就绪） |
| ACCEPTANCE_REJECTED | 契约验收未通过，回 BUILD |
| HUMAN_INTERVENTION | 🛑 熔断：同 BUG 修 ≥2 次，停下要人工 |
| COMPLETE | 全部通过，feature 分支可合并 |

## 计数器

```yaml
sa_spec_revision_count: 0       # SA 评审 spec NEEDS_REVISION 次数
sa_code_revision_count: 0       # SA 评审代码 NEEDS_REVISION 累计次数（per sprint）
qa_fix_count: {}                # 每个 BUG 的修复轮次：BUG-001: 0
evaluator_未通过_count: 0       # Evaluator 未通过累计次数
```

## 熔断阈值

```yaml
sa_code_revision_threshold: 3   # 累计 ≥3 次升级回 SPEC_REVIEWING
qa_fix_threshold: 3             # 同 BUG ≥3 次升级到 SPRINT_<N>_TECH_LEAD_REVIEW
evaluator_threshold: 2          # 累计 ≥2 次升级回 spec
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

### G2: 部署测试环境确认

```yaml
g2_approved: false              # fast 模式用（单 sprint）
# full 模式 per-sprint 标记（approve-deploy 时按当前 sprint 写入）：
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
