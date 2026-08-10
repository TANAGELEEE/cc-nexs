---
description: "Lean test 环境黑盒验收，直接把 AC 证据汇总到 plan.md。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task, mcp__chrome-devtools__*"
argument-hint: "[需求编号]"
---

# /cc-nexs:lean-verify

仅在成功 test release 后派发独立 `lean-verifier`，使用解析后的 runtime model profile。按 `plan.md` Test 环境验收矩阵执行全部 P0/P1 与跨端路径，只访问 `allowed_hosts`。

结果写入 `plan.md`，不得创建 test-cases/test-report/acceptance/BUG 文档。父 Orchestrator 调 `recordTestVerification()` 将结果绑定当前 attempt/environment revision：通过进入 `TEST_VERIFIED`，阻塞进入 `TEST_VERIFY_FAILED`。失败集中修复后必须重新本地验证、delta Review、test release 和回归。
