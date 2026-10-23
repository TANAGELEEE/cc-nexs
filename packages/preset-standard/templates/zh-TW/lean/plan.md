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
| LV-001 | AC-001 | targeted build/test/start/smoke |  |  |  |

## Test 環境驗收矩陣

| Check | AC | 環境動作 | 透過條件 |
|---|---|---|---|
| TV-001 | AC-001 |  |  |

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
- P0/P1 阻塞項：
- P2/P3 非阻塞項：
- 結論：待執行

## Review 閉環

- 修復的問題編號：
- Delta fingerprint：
- 結論：待執行

## Test 環境驗收

| Attempt | Environment revision | AC 覆蓋 | 結果 | 證據摘要 |
|---|---|---|---|---|

## 最終 AC 覆蓋

| AC-ID | 本地證據 | Test 證據 | 結果 |
|---|---|---|---|

## 計劃變更

| 日期 | 變更 | 是否影響批准範圍 | 處理 |
|---|---|---|---|

## Gateway B 變更請求

| ID | 型別 | 提出人 | 影響 AC | 允許修改路徑 | 意見 | 狀態 |
|---|---|---|---|---|---|---|
