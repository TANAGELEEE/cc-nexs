# 部署文件 — {編號}.{需求短名}

> **負責人**：Tech Lead
> **必含**：回滾步驟章節（獨立二級標題，不可省略）。

---

## 環境清單

| 環境 | 地址 | 用途 |
|------|------|------|
| dev  |      |      |
| test |      |      |
| prod |      |      |

> test/prod 不得共用 URL。自動流程只讀取私有 overlay/project config 的 `release.test.app_url`、`operations_url`、`allowed_hosts` 和 driver；生產釋出始終人工。

## Test release driver

| 專案 | 值 |
|---|---|
| test branch / 倉庫順序 | 見 `.cc-nexs/workspace.yml` 的 `test_branch` / `release_order` |
| driver | `release.test.driver`（stdin/stdout JSON 契約） |
| app URL | `release.test.app_url` |
| operations URL | `release.test.operations_url` |
| browser session | 複用當前已登入會話 |
| credential ref | 僅記錄 opaque ref；禁止賬號、密碼、token 明文 |

## 部署順序

1. DB 遷移（SQL 檔案：`*.sql`）
2. 配置中心變更
3. 服務釋出（灰度順序）
4. 冒煙驗證

## 配置變更

| Key | 環境 | 舊值 | 新值 | 生效方式 |
|-----|------|------|------|---------|
|     |      |      |      |         |

## DB 遷移

| SQL 檔案 | 作用 | 是否破壞相容 | 預計耗時 |
|---------|------|-------------|---------|
|         |      |             |         |

## 三方依賴 / 資源

- 新增環境變數：
- 新增雲資源：
- 新增金鑰：

## 監控 / 告警

- 新增指標：
- 新增告警規則：

## 灰度策略

- 灰度階段：
- 觀察指標：
- 達標判據：

---

## 回滾步驟 ⚠️ 必讀

### 觸發條件
- 嚴重 bug 定義：
- 效能劣化閾值：

### 回滾動作（按順序）
1. **服務層回滾**：
2. **配置回滾**：
3. **DB 回滾**：
4. **快取清理**：
5. **驗證點**：

### 回滾後覆盤
- 回滾完成後 24h 內產出故障報告（PM + Tech Lead）
- 回滾不清除 bugs/ 目錄，bug 生命週期正常繼續
