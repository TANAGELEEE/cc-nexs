# 計劃 — {編號}.{需求短名}

> 本檔案是 Lean 模式唯一計劃、Review 與驗證摘要。詳細執行日誌保留在本地臨時目錄，不貼上到此檔案。

<!-- APPROVAL-SCOPE START -->

## 現狀與邊界

- 可複用實現：
- 影響倉庫/模組：
- 非目標：

## 技術方案

- 核心設計：
- 前後端/API 契約：
- 資料庫與配置：
- 相容與回滾：

## 任務與並行波次

| Task | AC | 倉庫 | 允許修改路徑 | 依賴 | 驗證 | 波次 |
|---|---|---|---|---|---|---|
| T-001 | AC-001 |  |  | 無 |  | W1 |

## 交付策略

- delivery_lane: pending
- Fast-track 資格：複用既有能力 / 無新增表結構或遷移 / 無新增基礎設施與金鑰 / 無公開破壞性契約 / 風險為 low 或 medium
- 不滿足項與理由：

## Test 交付拓撲

每個程式碼倉必須保留一條機器可解析的策略行；`deploy` 必須配置 `test_branch`，`local` 僅用於從精確 candidate worktree 本地啟動並連線已部署的 test 服務。

- test_delivery.<repo-id>: deploy / local

| 倉庫 | Candidate 去向 | 驗證方式 |
|---|---|---|
|  | test_branch / local | 部署到 test / 本地啟動並連線 test 後端 |

## 本地驗證矩陣

| Check | AC | 型別 | 命令/Driver | 透過條件 | 無法本地執行時的 Test 動作 |
|---|---|---|---|---|---|
| LV-001 | AC-001 | lint/typecheck/targeted test/browser |  |  |  |

本地驗證只做部署前的快速回饋，主要驗收在 test 環境。前端跑 lint、型別檢查和定向測試，受影響頁面用 `browser: <啟動命令> @ <頁面路徑>` 行做瀏覽器驗證；後端跑定向測試。完整生產構建由 CI 執行，僅當改動構建配置、依賴、lockfile、路由生成或發佈流程時才放入矩陣。若 test 環境放寬了生產校驗（嚴格構建、發佈或翻譯校驗），把受影響範圍的生產嚴格命令放入此矩陣：test 無法證明它。

## Test 環境驗收矩陣

| Check | AC | 環境動作 | 透過條件 |
|---|---|---|---|
| TV-001 | AC-001 |  |  |

## 基線與末端取樣

- 基線快檢（在 base 實跑快速檢查與依賴安裝乾跑；既有失敗及需要的決定）：
- 末端消費者（索引、採集、流水線、批次處理等；沒有則寫「無」）：
- 准入條件與真實取樣結果（基於當前來源與實際輸出，不發佈）：

## 預授權 Test 操作

- Test 環境操作（動作、目標、回滾；Gateway A 後不再詢問）：
- Test 整合策略（衍生路徑，每條寫重新產生命令，或在 Test 不使用候選值時寫「保留 Test 側」；沒有則寫「無」）：
- derived_binding: each-candidate / before-final-test（保留其一；before-final-test 表示衍生路徑在原始碼通過 Test 前保持 base 值，通過後一次產生並做最後一輪 Test）

## 風險與釋出

- risk_tier: pending
- 風險判斷依據：
- 集中 Review 關注點：
- 釋出順序：
- 回滾方案：

## 複雜度與規模

- 複雜度：low / medium / high
- 高風險項：無 / 多模組高耦合 / 公開契約破壞 / 許可權或資金高風險 / 破壞性遷移 / 其他
- 規模建議：保持單一 Lean 需求 / 拆分為多個 Lean 需求
- 判斷依據：

<!-- APPROVAL-SCOPE END -->

## 計劃審核

- 審核方式：skipped（low/medium，由人在 Gateway A 審）/ 獨立事實核查（high/critical）
- 計劃來源：Planner 起草 / 使用者 plan mode（--from）
- 審核輪次：
- P0/P1 阻塞項：
- 非阻塞建議：
- 计划审核结论：待執行

## 執行狀態

| Task | 狀態 | 修改路徑 | Candidate | 備註 |
|---|---|---|---|---|

## 本地驗證記錄

| Attempt | Candidate fingerprint | 結果 | 證據摘要 |
|---|---|---|---|

## 集中 Review

- Reviewed fingerprint：
- Finder 視角：
- 阻塞項（實際跑出並經 Judge 復跑確認的 P0/P1）：
- 未證實項（交給 test 驗收的 probe）：
- P2/P3、已駁回與格式不合格項：
- 結論：待執行

<!-- Judge 在本段結尾寫入唯一的 `cc-nexs-review` 區塊，格式見 rules/review-findings.md -->

## Review 閉環

- 復跑的問題編號：
- Delta fingerprint：
- 結論：待執行

<!-- 閉環同樣以 `cc-nexs-review` 區塊結尾，round 為 closure -->

## Test 環境驗收

| Attempt | Environment revision | AC 覆蓋 | 結果 | 證據摘要 |
|---|---|---|---|---|

## 最終 AC 覆蓋

| AC-ID | 本地證據 | Test 證據 | 結果 |
|---|---|---|---|

## 上線後事項

base 合併後、本次發佈不執行的步驟（生產部署、資料或索引重建、通知等）。每步寫一行 `- [ ] 步驟`，沒有則寫「無」；完成後勾選。`cc-nexs status` 會列出未完成項。

## 計劃變更

| 日期 | 變更 | 是否影響批准範圍 | 處理 |
|---|---|---|---|

## Gateway B 變更請求

| ID | 型別 | 提出人 | 影響 AC | 允許修改路徑 | 意見 | 狀態 |
|---|---|---|---|---|---|---|
