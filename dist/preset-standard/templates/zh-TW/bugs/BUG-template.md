# BUG-{序號} — {短描述}

> **檔名規則**：`BUG-001.md`、`BUG-002.md`...
> **復現指令碼**：必須與本檔案同目錄或 `qa-scripts/` 下，不接受純文字描述。

## 基本資訊

| 欄位 | 值 |
|------|-----|
| 狀態 | OPEN / FIXED / VERIFIED / WONTFIX |
| 嚴重度 | P0 / P1 / P2 / P3 |
| 來源 | sprint-qa / hotfix |
| 所屬 Sprint | M1 / M2 / ...（hotfix 來源可空）|
| 關聯契約 | AC-xxx（hotfix 來源可空）|
| 關聯用例 | TC-M1-xxx |
| 發現人 | QA / 使用者 / 監控 |
| 發現時間 | YYYY-MM-DD |
| 修復人 | Tech Lead |
| 關聯 commit | abcd1234 |
| 是否已上線 | 是 / 否（已上線 P0/P1 必須含回滾步驟）|
| 升檔歷史 | 例如：P2 → P1（QA 第 2 輪迴歸仍失敗）|

## 現象

（一段話描述 bug 表現，包括錯誤碼、異常棧、UI 截圖路徑。）

## 復現步驟

（操作步驟，配合下方指令碼。）

1.
2.
3.

## 復現指令碼

路徑：`qa-scripts/BUG-001-repro.sh`（或同目錄 `BUG-001-repro.*`）

```bash
#!/usr/bin/env bash
# 本指令碼必須可執行，返回非零退出碼 = bug 存在
set -euo pipefail

# ...
```

## 根因

（Tech Lead 修復時填。沒調查清楚前不要寫"未知"——必須定位到檔案:行。）

## 修復方案

（Tech Lead 填。說明程式碼改了什麼、為什麼這麼改、是否有副作用。）

## 影響範圍

- 受影響的介面：
- 受影響的資料：
- 是否需要資料修復：

## 評審

<!-- hotfix P2 / P0 / P1 用：SA 輕量評審 append 在這裡，不開獨立 sa-code-review.md。
     sprint 流程的 BUG 走 sa-code-review.md，本節留空即可。 -->

### Round 1 — YYYY-MM-DD — 結論: PASS / NEEDS_REVISION

（SA 評審意見……）

## 迴歸記錄

（QA 迴歸時 append，不覆蓋歷史。）

### Round 1 — YYYY-MM-DD
- 執行指令碼：`qa-scripts/BUG-001-repro.sh`
- 退出碼：0（透過）
- 關聯 P0/P1 防迴歸：TC-M1-001, TC-M1-002, TC-M1-003 全部透過
- 狀態變更：FIXED → VERIFIED

## 為什麼原測試沒抓到

<!-- 強制回答，推動補用例。
     答完之後必須在 test-cases.md 追加新用例（標 關聯BUG: BUG-xxx）。 -->

（必填。）

## 上線影響 / 回滾步驟

<!-- 僅 P0/P1 + 已上線 必填。其他檔位可空。 -->

（如已上線，描述生產資料是否需要修復 / 回滾步驟）
