# Hotfix {编号} · {需求短名}

> 此文件是 `progress.json` 的只读人类视图；不得直接推进状态。新任务机器状态位于 workspace `.cc-nexs/hotfixes/<key>/`，BUG 文档由 `progress.hotfix_document` 指定；旧任务保留原 hotfix.md 和状态位置。

## 当前状态

```yaml
current_state: INIT
updated_at: null
```

## 状态骨架

`INIT → HOTFIX_IMPLEMENTING → HOTFIX_IMPLEMENTED → HOTFIX_LOCAL_VERIFYING → HOTFIX_REVIEWING → HOTFIX_CANDIDATE_READY → HOTFIX_TEST_RELEASE → HOTFIX_TEST_VERIFYING → HOTFIX_RELEASE_PENDING_HUMAN → HOTFIX_BASE_MERGING → COMPLETE`

任何修复最多经过一次 `HOTFIX_LOCAL_REVERIFYING → HOTFIX_DELTA_REVIEW`。再次阻塞进入 `HUMAN_INTERVENTION`。P3 同样需要独立 Review。已有用户授权的同一故障修订使用 `revise-hotfix` 在原 key/分支重绑、保留历史并清除当前证据；不得手改状态或计数。

## 历史轨迹

- (尚无)
