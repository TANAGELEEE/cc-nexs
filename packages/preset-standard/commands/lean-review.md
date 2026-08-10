---
description: "Lean 一次集中 Review 与最多一次 delta 闭环检查。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "[需求编号] [--closure|--gateway-b-delta]"
---

# /cc-nexs:lean-review

先用 `assertPlanApprovalCurrent` 验证 Gateway A hash，再从绑定的 `risk_tier` 解析 `lean-reviewer`：`resolveRoleRuntime(..., {models: mergedModels, featureConfig, progress: progressV2, planText})`。`high|critical` 自动命中 `escalated`；feature 显式 profile 最终优先。打印风险来源、matched rule 和最终 profile/model/effort。Reviewer 可配置为不同模型，也可与 Developer 使用同一模型但更高 effort；无论配置如何都必须是独立 session。

完整 Review 输入仅为批准 requirements、plan scope、全部仓库累计 diff、变更文件清单和同 candidate 的本地证据。一次性输出全部 P0/P1；P2/P3 非阻塞。写入 `plan.md` 后由父 Orchestrator执行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --passed|--blocked [--finding "P0/P1 finding"]...
```

`--closure` 只审问题编号和修复 delta，并执行 `record-review ... --closure`。闭环再次失败直接 `HUMAN_INTERVENTION`，不得开始第三轮 Review。

`--gateway-b-delta` 只审当前 Gateway B request、对应代码 delta、受影响调用面和同 candidate 的新本地证据，然后执行 `record-review ... --gateway-b-delta`。PASS 后必须重新发布 test 并回归；NEEDS_REVISION 直接人工介入，不开始新的自动 Review 循环。
