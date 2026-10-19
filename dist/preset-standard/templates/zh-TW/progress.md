# {編號} {需求短名} 進度

> 本檔案是 `progress.json` v2 的人類可讀映象，由 orchestrator 重新整理。權威狀態、gate、計數器和事件只在 progress.json；禁止任何角色直接修改兩者。

## 當前狀態

```yaml
current_state: INIT
updated_at: null
```

## 狀態機字典

> 狀態分三套：lean 是新需求預設，full 可按多個 Sprint 開發，fast 固定單 Sprint。
> 由 progress.json.mode 決定走哪一套，並要求與 config.json.mode 一致。

### lean 模式（mode=lean，預設）

| 狀態 | 含義 |
|---|---|
| INIT / PLANNING | Lean Planner 維護 requirements.md 與 plan.md |
| **PLAN_PENDING_HUMAN** | ⏸️ Gateway A，批准 requirements + plan scope 雜湊 |
| PLAN_APPROVED / IMPLEMENTING | 按路徑所有權在每倉 feature worktree 實現 |
| LOCAL_VERIFYING | 確定性 driver 執行 build/start/smoke/e2e |
| CONSOLIDATED_REVIEW | 獨立 Reviewer 一次性審全部累計 diff，只阻塞 P0/P1 |
| REVIEW_FIXING / LOCAL_REVERIFYING / REVIEW_CLOSURE | 阻塞項修復、本地複驗、最多一次 delta closure |
| CANDIDATE_READY / TEST_RELEASE | 精確 candidate 合入 test 併發布 |
| TEST_VERIFYING / TEST_FIXING | test 黑盒驗收；失敗後完整修復閉環 |
| TEST_VERIFIED | test 環境全部必要 AC 透過 |
| **RELEASE_PENDING_HUMAN** | ⏸️ Gateway B，批准 reviewed + test-verified fingerprint |
| GATEWAY_B_CHANGE_REQUESTED / FIXING / LOCAL_REVERIFYING / DELTA_REVIEW | Gateway B 範圍內意見的單次增量修復閉環 |
| SCOPE_CHANGE_REQUESTED | Gateway B 改變需求/AC/方案邊界，返回 Planner 與 Gateway A |
| BASE_MERGING | Git Custodian non-force 合入配置 base，docs 最後 |
| COMPLETE | base 整合與清理完成 |
| HUMAN_INTERVENTION / *_BLOCKED | delta Review、釋出或分支保護需要人工處理 |

### full 模式（mode=full）

| 狀態 | 含義 |
|---|---|
| INIT | 需求目錄已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已寫，待 Planner 展開 spec |
| SPEC_DRAFTED | spec.md 已寫，待 SA 評審 |
| SPEC_REVIEWING | SA 在評審 spec |
| SPEC_NEEDS_REVISION | SA 評審未透過，回 Planner 修訂 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等當前執行時的 approve-spec 入口 |
| SPEC_APPROVED | 人工放行，進入 Sprint 迴圈 |
| SPRINT_<N>_KICKOFF | Sprint N 啟動 |
| SPRINT_<N>_QA_CASES | QA 在寫 Sprint N 測試用例 |
| SPRINT_<N>_DEV | Tech Lead 在寫 Sprint N 程式碼 |
| SPRINT_<N>_SA_TEST_REVIEW | SA 在審 Sprint N 測試用例 |
| SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION | SA 打回測試用例，待 QA 修訂後重新評審 |
| SPRINT_<N>_DOC_SYNC | Tech Lead 同步 deploy.md / api-doc.md |
| SPRINT_<N>_DOC_SYNC_DONE | Sprint 文件同步完成，待程式碼評審 |
| SPRINT_<N>_SA_CODE | SA 在評審 Sprint N 程式碼 |
| SPRINT_<N>_FIX / FIX_DONE | 修復 Sprint 評審項並重新評審 |
| SPRINT_<N>_DEV_DONE | Sprint N 開發閉環完成；不部署、不驗收 |
| ALL_SPRINTS_DEV_DONE | 全部 Sprint 開發完成 |
| INTEGRATION_REVIEW | 完整 candidate 跨 Sprint/跨倉評審 |
| INTEGRATION_FIX | 整合修訂完成，待重新評審 |
| TEST_RELEASE | 完整需求合入 test + 釋出；預設 auto_if_ready |
| TEST_RELEASE_BLOCKED | test 合併/driver/釋出失敗，停止處理 |
| TEST_DEPLOYED_NEEDS_MANUAL_VERIFY | 已部署但自動環境驗證不能完成 |
| FINAL_QA | QA 在已部署 test 環境執行累計用例 |
| FINAL_QA_BLOCKED | 部署後測試發現問題 |
| FINAL_FIX / FINAL_FIX_REVIEW | 修復、獨立複審，之後必須重新 TEST_RELEASE |
| SPRINT_<N>_TECH_LEAD_REVIEW | 🛑 熔斷：同 BUG 修 3 次升級 |
| FINAL_EVAL | Evaluator 最終全量打分 |
| COMPLETE | 全部透過，feature 分支可合併 |

`SPRINT_<N>_DEPLOY_GATE / QA_RUN / QA_REGRESSION / EVAL / DONE / ALL_SPRINTS_DONE` 僅用於沒有 `delivery` 欄位的 legacy `per_sprint` 需求。

### fast 模式（mode=fast，單 sprint 三角色合併）

| 狀態 | 含義 |
|---|---|
| INIT | 需求目錄已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md 已寫，待 Fullstack 展開 spec |
| SPEC_DRAFTED | spec.md 已寫，待 Reviewer 評審 |
| SPEC_REVIEWING | Reviewer 在評審 spec |
| SPEC_NEEDS_REVISION | Reviewer 評審未透過，回 Fullstack 修訂 |
| **SPEC_PENDING_HUMAN** | ⏸️ 人工 gate G1，等當前執行時的 approve-spec 入口 |
| SPEC_APPROVED | 人工放行，進入實現階段 |
| BUILD | Fullstack 在寫程式碼 + 同步 dev-plan/api-doc/deploy |
| CODE_REVIEW | Reviewer 評審程式碼（僅 sa-code-review.md） |
| CODE_REVIEW_NEEDS_REVISION | 程式碼評審未透過，回 Fullstack 修 |
| TEST_RELEASE | 完整 candidate 預設自動釋出 test；能力不足時在此回退人工 G2 |
| TEST | Verifier 一次產 test-cases.md + test-report.md（initial） |
| TEST_BLOCKED | Verifier 報阻塞，進入修復 |
| FIX | Fullstack 在修指定 BUG |
| FIX_REVIEW | Reviewer 評審修復 candidate；PASS 後重新 TEST_RELEASE |
| REGRESSION | 新 test 部署後 Verifier 迴歸（重跑 BUG repro + sprint P0/P1） |
| TEST_PASSED | Verifier 透過，進入契約驗收 |
| ACCEPTANCE | Reviewer 產 acceptance.md（此時 test-report.md 已就緒） |
| ACCEPTANCE_REJECTED | 契約驗收未透過，回 BUILD |
| HUMAN_INTERVENTION | 🛑 熔斷：同 BUG 修 ≥2 次，停下要人工 |
| COMPLETE | 全部透過，feature 分支可合併 |

## 計數器

```yaml
review_revision: 0              # 當前 review 迴圈連續 NEEDS_REVISION 次數；PASS 後清零
fix_per_bug: {}                 # 同一 BUG 連續部署迴歸失敗次數；VERIFIED 後清除
evaluator_reject: 0             # 當前 acceptance 迴圈連續拒絕次數；PASS 後清零
```

## 熔斷閾值

```yaml
review_revision: 3              # 當前 review 迴圈連續 ≥3 次升級回 SPEC_REVIEWING
fix_per_bug: 3                  # 同 BUG 連續 ≥3 次升級到 TECH_LEAD_REVIEW
evaluator_reject: 2             # 當前 acceptance 迴圈連續 ≥2 次升級回 spec
```

## Sprint 進度

```yaml
total_sprints: 0                # Planner 展開 spec 時填
current_sprint: 0
sprint_status:
  # M1: not_started | in_progress | done
```

## 人工 gate

### G1: Spec 審批

```yaml
human_approved_at: null
human_approver: null
spec_summary_for_human: null    # orchestrator 在 SPEC_PENDING_HUMAN 時填
```

### G2: 手工 test 釋出確認（僅顯式退出或前置能力不足）

```yaml
g2_approved: false              # final_only/fast 的完整需求手工釋出確認
# legacy full per-sprint 標記：
# g2_sprint_1_approved: true
# g2_sprint_2_approved: true
g2_approved_at: null
g2_approver: null
```

## 歷史軌跡

<!-- 每次狀態轉移由 orchestrator append 一行 -->
<!-- 格式：- <ISO8601> <prev_state> → <next_state>  原因 -->

- (尚無)

## 待人工接入

<!-- 物理不可為的項追加在這裡，不阻塞流程 -->
<!-- 例如：生產部署 / 真機 UI 驗證 / 業務口徑確認 -->

- (尚無)
