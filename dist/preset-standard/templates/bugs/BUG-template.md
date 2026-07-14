# BUG-{序号} — {短描述}

> **文件名规则**：`BUG-001.md`、`BUG-002.md`...
> **复现脚本**：必须与本文件同目录或 `qa-scripts/` 下，不接受纯文字描述。

## 基本信息

| 字段 | 值 |
|------|-----|
| 状态 | OPEN / FIXED / VERIFIED / WONTFIX |
| 严重度 | P0 / P1 / P2 / P3 |
| 来源 | sprint-qa / hotfix |
| 所属 Sprint | M1 / M2 / ...（hotfix 来源可空）|
| 关联契约 | AC-xxx（hotfix 来源可空）|
| 关联用例 | TC-M1-xxx |
| 发现人 | QA / 用户 / 监控 |
| 发现时间 | YYYY-MM-DD |
| 修复人 | Tech Lead |
| 关联 commit | abcd1234 |
| 是否已上线 | 是 / 否（已上线 P0/P1 必须含回滚步骤）|
| 升档历史 | 例如：P2 → P1（QA 第 2 轮回归仍失败）|

## 现象

（一段话描述 bug 表现，包括错误码、异常栈、UI 截图路径。）

## 复现步骤

（操作步骤，配合下方脚本。）

1.
2.
3.

## 复现脚本

路径：`qa-scripts/BUG-001-repro.sh`（或同目录 `BUG-001-repro.*`）

```bash
#!/usr/bin/env bash
# 本脚本必须可执行，返回非零退出码 = bug 存在
set -euo pipefail

# ...
```

## 根因

（Tech Lead 修复时填。没调查清楚前不要写"未知"——必须定位到文件:行。）

## 修复方案

（Tech Lead 填。说明代码改了什么、为什么这么改、是否有副作用。）

## 影响范围

- 受影响的接口：
- 受影响的数据：
- 是否需要数据修复：

## 评审

<!-- hotfix P2 / P0 / P1 用：SA 轻量评审 append 在这里，不开独立 sa-code-review.md。
     sprint 流程的 BUG 走 sa-code-review.md，本节留空即可。 -->

### Round 1 — YYYY-MM-DD — 结论: PASS / NEEDS_REVISION

（SA 评审意见……）

## 回归记录

（QA 回归时 append，不覆盖历史。）

### Round 1 — YYYY-MM-DD
- 执行脚本：`qa-scripts/BUG-001-repro.sh`
- 退出码：0（通过）
- 关联 P0/P1 防回归：TC-M1-001, TC-M1-002, TC-M1-003 全部通过
- 状态变更：FIXED → VERIFIED

## 为什么原测试没抓到

<!-- 强制回答，推动补用例。
     答完之后必须在 test-cases.md 追加新用例（标 关联BUG: BUG-xxx）。 -->

（必填。）

## 上线影响 / 回滚步骤

<!-- 仅 P0/P1 + 已上线 必填。其他档位可空。 -->

（如已上线，描述生产数据是否需要修复 / 回滚步骤）
