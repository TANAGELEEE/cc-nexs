# 測試報告 — {編號}.{需求短名}

> **負責人**：QA（Codex，黑盒）
> **本檔案產出**：執行記錄 + 覆蓋審計。**不做驗收結論**——驗收結論在 acceptance.md（Evaluator 產）。
> **規則**：Sprint 階段累計用例；預設只在完整需求釋出 test 後按 Final Release × Round append 執行記錄。legacy per_sprint 可保留原章節。

---

## 狀態彙總

| Sprint | Round | 日期 | 執行結果 | Bug 數 |
|--------|-------|------|---------|--------|
| M1     | 1     | YYYY-MM-DD | 阻塞 | 3 |
| M1     | 迴歸 1 | YYYY-MM-DD | 透過 | 0 |
| M2     | 1     |  |  |  |

---

## Sprint M1 Round 1 — YYYY-MM-DD

### 執行範圍
- 用例：TC-M1-001 ~ TC-M1-015（P0/P1 共 10 條）
- 自動化指令碼：`qa-scripts/TC-M1-*.sh`
- 未執行：TC-M1-016（manual，標記待人工接入）

### AC-ID × 用例 × 結果 覆蓋審計

| AC-ID | 用例 | 結果 | 指令碼 |
|-------|------|------|------|
| AC-001 | TC-M1-001 | 透過 | qa-scripts/TC-M1-001.sh |
| AC-001 | TC-M1-002 | 失敗 → BUG-001 | qa-scripts/TC-M1-002.sh |
| AC-002 | TC-M1-003 | 透過 | qa-scripts/TC-M1-003.sh |
| AC-003 | TC-M1-004 | 失敗 → BUG-002 | qa-scripts/TC-M1-004.sh |
| AC-NF-001 | TC-M1-P-001 | 透過 | qa-scripts/TC-M1-P-001.sh |
| AC-NF-002 | TC-M1-S-001 | 透過 | qa-scripts/TC-M1-S-001.sh |

### 發現的 Bug
- BUG-001（P0）：見 `bugs/BUG-001.md`
- BUG-002（P1）：見 `bugs/BUG-002.md`
- BUG-003（P2）：見 `bugs/BUG-003.md`

### 覆蓋判定
- 本 sprint AC 覆蓋率：100%（所有 AC-ID 至少 1 條 P0/P1 用例）
- 程式碼行覆蓋：XX%（不硬卡）
- 主動放棄覆蓋的路徑：
  - 路徑：XXX。理由：屬於降級場景，需要生產依賴不可在測試環境模擬，列"待人工接入"。

### 待人工接入
- [ ] 型別：QA 物理不可為 — 生產冒煙
  - 動作：拉灰度流量跑 TC-M1-016
  - 建議執行人：運維 + PM

### 結論
**結論: 阻塞**（3 個 bug 待修復，回第 6 步）

---

## Sprint M1 迴歸 Round 1 — YYYY-MM-DD

### 執行範圍
- 狀態為 FIXED 的 BUG：BUG-001, BUG-002, BUG-003
- 復現指令碼重跑 + 本 sprint 關聯 P0/P1 用例重跑

### 結果
| BUG | 復現指令碼 | 結果 | 狀態變更 |
|-----|---------|------|---------|
| BUG-001 | bugs/BUG-001-repro.sh | 透過 | FIXED → VERIFIED |
| BUG-002 | bugs/BUG-002-repro.sh | 透過 | FIXED → VERIFIED |
| BUG-003 | bugs/BUG-003-repro.sh | 透過 | FIXED → VERIFIED |

### 防迴歸用例重跑
- TC-M1-001 ~ TC-M1-015 全部 P0/P1：透過
- 新發現 bug：無

### 結論
**結論: 透過**（本 sprint 可進入 Evaluator 驗收）

---

## Sprint M2 Round 1 — YYYY-MM-DD

（按同結構 append）

---

## Final Release R1 — YYYY-MM-DD

> 完整 candidate 首次釋出 test 後執行。修復重新發布使用 `## Final Regression Release R<N>`，不得覆蓋歷史。

### 釋出證據

| release attempt | environment_revision | pipeline | deployment | test URLs |
|---|---|---|---|---|
| test-release-1 |  |  |  |  |

### 累計執行範圍

- 全部 Sprint P0/P1：
- 跨 Sprint/跨倉整合路徑：
- 前端/運維臺瀏覽器檢查：
- 未執行的必需用例（非空則結論必須阻塞）：

### 總量統計
- 用例總數：
- 透過率：
- Bug 總數 / 修復率：
- 覆蓋的 AC-ID：N/N

### 遺留待人工接入清單
（可選/生產專屬項可列出；必需 P0/P1 不得以待人工接入冒充透過）

### 移交給 Evaluator
- spec.md 驗收契約（全部 AC-ID）
- 本檔案各 sprint 執行記錄
- bugs/ 下 VERIFIED 列表

**結論: 透過**（執行層面；最終契約驗收以 acceptance.md 為準）
