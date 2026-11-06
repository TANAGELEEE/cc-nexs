# BUG {編號} · {需求短名}

## Bug 與影響

- 現象：
- 影響物件/環境：
- 復現方式：
- 緊急性：
- 根因：
- 為什麼原測試未發現：

## 繫結範圍

填寫實際路徑和驗證命令後繫結。範圍、分級或命令調整使用 `revise-hotfix` 記錄已有使用者授權；契約/schema/許可權擴充套件使用 `--promote-lean`，在原 BUG 旁升級為 Lean 並重新經過 Gateway A。

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

### 本地驗證矩陣

| Check | 倉庫 | 命令/Driver | 預期結果 |
|---|---|---|---|
<!-- HOTFIX-SCOPE END -->

`intended_paths` 填寫逗號分隔的 `repo-id/path`；P0/P1 必須填寫受影響 AC、回滾負責人和步驟。矩陣每行填寫唯一 Check ID 和實際命令，至少覆蓋必要復現與迴歸檢查；不要用說明文字或佔位命令代替。矩陣只放 lint、型別檢查和定向測試；修改頁面且能在本地執行時，再加 `browser: <啟動命令> @ <頁面路徑>` 行。完整生產構建由 CI 執行，僅當改動構建配置、依賴、lockfile、路由生成或發佈流程時才放入矩陣。

## 實現與回滾

- 修復方案：
- 影響呼叫面：
- 回滾驗證證據：

## 本地驗證

使用配置的 driver，或在無 driver 時執行繫結矩陣內的命令並登記 `check/command/exit_code/proof/result`；瀏覽器行登記 `check/method/command/proof/result`。證據繫結精確 candidate；僅因本地環境無法執行的檢查可寫明原因和 test 動作後延期到 test，並由 test 驗收關閉。

## 集中 Review

P0/P1/P2/P3 均需獨立 Review。檔案數和變更行數僅作風險參考，不能證明沒有行為變化。記錄候選、阻塞項和修復 delta 的結論。只有實際跑出並經 Judge 復跑確認的 P0/P1 才阻塞；未證實項交給 test 驗收作 probe。本段以 `cc-nexs-review` 區塊結尾（rules/review-findings.md）。

## Test 環境驗收

- candidate fingerprint：
- test attempt / environment revision：
- BUG repro：
- 受影響 AC / P0/P1：
- 冒煙：
- 結論：
- 環境限制與未完成驗證：

## Gateway B 變更請求

| ID | 型別 | 提出人 | 允許修改路徑 | 意見 | 狀態 |
|---|---|---|---|---|---|

## 釋出摘要

- test 目標：配置的 `test_branch`
- base 目標：配置的 `base_branch`
- 精確 candidate：
- 人工批准：
- 環境例外授權與回滾證據（如適用）：

環境例外僅授權配置 base 整合；test 未透過的事實保留，不預設授權生產部署。
