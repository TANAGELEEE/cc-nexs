# Spec — {編號}.{需求短名}

> **負責人**：Planner（Codex）
> **禁止**：Planner 不寫程式碼、不評審程式碼、不執行測試
> **權威來源**：本檔案。business 部分的變更走 requirements.md，技術+契約+切片走本檔案。

---

## 業務背景

（從 requirements.md 摘錄核心業務訴求，一段話講清楚"為什麼做"和"給誰用"。不要複製全文，只留 Planner 做技術決策必須知道的業務要點。）

- 使用者角色：
- 觸發場景：
- 業務目標：
- 非目標（明確不做）：

---

## 技術方案

### 架構概覽
（模組邊界、呼叫鏈路、資料流向。一張圖 + 三句話。）

### 關鍵設計決策
| # | 決策點 | 選項 | 最終選擇 | 理由 |
|---|--------|------|---------|------|
| D1 |        |      |         |      |
| D2 |        |      |         |      |

### 資料模型
（如涉及資料儲存，列出新增/修改的表、欄位、索引、遷移檔案和回滾策略；具體命名遵守專案 overlay。）

### API 設計
（對外暴露的介面列表。詳細契約走 api-doc.md，這裡只列清單和路徑。）

### 第三方依賴
（新增的 maven 依賴、外部服務、環境變數。每項給一句"為什麼需要"。）

---

## 影響範圍

### 程式碼影響
- 新增模組：
- 修改模組：
- 廢棄模組：

### 資料影響
- 新增表/欄位：
- 資料遷移：
- 回滾資料風險：

### 介面影響
- 新增介面：
- 改變語義的介面（⚠️破壞相容性）：
- 下線介面：

### 運維影響
- 配置變更：
- 部署順序依賴：
- 監控/告警新增：

### 現狀對照（來自 repo-context.md，**硬性要求**）

> Planner 必須基於 RECON 階段產出的 `repo-context.md` 逐條標註。SA 評審會校驗。

| 決策 | 既有項（repo-context 章節） | 複用 / 擴充套件 / 新建 | 理由 |
|------|---------------------------|---------------------|------|
|      |                           |                     |      |

**衝突點**（命名 / schema / 配置開關重名等）：
-

---

## 實施所有權與並行波次

> 該表在 G1 前凍結。Fast/Full 對同一 Wave、不同 Repository 的實現單元並行派發；同一 Repository 必須放入不同 Wave 序列。介面契約已經在本 spec 固定時，前後端不應僅因呼叫關係被序列化。`Allowed paths` 使用倉庫相對路徑，可用 `<br>` 分隔；禁止絕對路徑和 `..`。

<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-backend | M1 | backend | AC-001, AC-002 | backend-java | src/main/java/example/** | - | module build + unit | 1 |
| IMP-web | M1 | web | AC-001, AC-003 | web | src/features/example/** | - | typecheck + unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->

規則：

1. 所有 AC 至少被一個 Assignment 覆蓋；每個 Assignment 只能寫一個已分配 Repository。
2. 同一 Wave 不得出現兩個相同 Repository；共享 worktree、lockfile、formatter、codegen 或構建目錄必須序列。
3. `Depends on` 只能引用同一 Sprint 更早 Wave；沒有真實程式碼生成依賴時，不得把已凍結介面契約的前後端人為序列化。
4. 實現 worker 禁寫 `dev-plan.md`、`api-doc.md`、`deploy.md`；共享文件在所有實現 join 後由唯一 owner 同步。
5. Full 模式的 AC/Assignment Sprint 必須從 M1 連續到 MN，不得缺失中間 Sprint；G1 凍結 N。Fast/Lite 只允許 M1。

---

## 驗收契約

> **規則**：每條契約必須可測試（有明確輸入/輸出或可觀測狀態）；至少 5 條；用 Given/When/Then 或 checklist。
> **反向引用**：test-cases.md 每條用例必須標 `關聯契約: AC-xxx`。
> **Evaluator 打分依據**：acceptance.md 按此表逐條評分。

| AC-ID | 模組 | Given（前置） | When（動作） | Then（預期） | 優先順序 | 所屬 Sprint |
|-------|------|---------------|--------------|--------------|--------|-------------|
| AC-001 |      |              |              |              | P0     | M1          |
| AC-002 |      |              |              |              | P0     | M1          |
| AC-003 |      |              |              |              | P1     | M1          |
| AC-004 |      |              |              |              | P0     | M2          |
| AC-005 |      |              |              |              | P1     | M2          |

### 非功能契約（效能 / 安全 / 相容性）
| AC-ID | 維度 | 指標 | 達成判據 | 所屬 Sprint |
|-------|------|------|---------|-------------|
| AC-NF-001 | 效能 | P99 響應時間 | ≤ 200ms | M1 |
| AC-NF-002 | 安全 | SQL 注入 | 全部引數化查詢透過掃描 | M1 |
| AC-NF-003 | 相容 | 老介面行為 | 既有呼叫方無需改動 | M2 |

---

## Sprint 切片

> **規則**：切片按 AC 依賴和能獨立交付為原則，不按預估 diff 行數或 commit 數量切分。

| Sprint | 範圍描述 | 覆蓋 AC-ID | 預估 diff 行數 | 預估用例數 | 依賴（前置 sprint） |
|--------|---------|-----------|---------------|-----------|---------------------|
| M1     |         | AC-001, AC-002, AC-003, AC-NF-001, AC-NF-002 | ~800  | ~15 | 無 |
| M2     |         | AC-004, AC-005, AC-NF-003 | ~1200 | ~20 | M1 |
| M3     |         |           |               |           |                     |

### Sprint 完成定義（DoD）
一個 sprint 被認為完成，當且僅當：
1. 該 sprint 所有 AC-ID 已實現且所需本地驗證透過；預設 final_only 在完整需求 test 釋出後統一驗收打分
2. 該 sprint 已知阻塞缺陷已修復並有驗證證據；需要 test 的驗證留在完整需求驗收階段
3. sa-code-review.md 本 sprint 章節最終 `結論: PASS`
4. candidate 與評審、驗證證據一致；不因 commit 數量改寫已驗證歷史

---

## 變更記錄

| 日期 | 變更內容 | 觸發原因 | 影響的 AC-ID / Sprint | 操作人 |
|------|---------|---------|----------------------|--------|
| YYYY-MM-DD | 初版 | Planner 展開 requirements.md | 全部 | Planner |
