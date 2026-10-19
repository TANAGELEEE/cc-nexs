# Hotfix {編號} · {需求短名}

> 此檔案是 `progress.json` 的只讀人類檢視；不得直接推進狀態。新任務機器狀態位於 workspace `.cc-nexs/hotfixes/<key>/`，BUG 文件由 `progress.hotfix_document` 指定；舊任務保留原 hotfix.md 和狀態位置。

## 當前狀態

```yaml
current_state: INIT
updated_at: null
```

## 狀態骨架

`INIT → HOTFIX_IMPLEMENTING → HOTFIX_IMPLEMENTED → HOTFIX_LOCAL_VERIFYING → HOTFIX_REVIEWING → HOTFIX_CANDIDATE_READY → HOTFIX_TEST_RELEASE → HOTFIX_TEST_VERIFYING → HOTFIX_RELEASE_PENDING_HUMAN → HOTFIX_BASE_MERGING → COMPLETE`

任何修復最多經過一次 `HOTFIX_LOCAL_REVERIFYING → HOTFIX_DELTA_REVIEW`。再次阻塞進入 `HUMAN_INTERVENTION`。P3 同樣需要獨立 Review。已有使用者授權的同一故障修訂使用 `revise-hotfix` 在原 key/分支重綁、保留歷史並清除當前證據；不得手改狀態或計數。

## 歷史軌跡

- (尚無)
