---
description: "Lean test 环境黑盒验收，直接把 AC 证据汇总到 plan.md。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task, mcp__chrome-devtools__*"
argument-hint: "[需求编号]"
---

# /cc-nexs:lean-verify

仅在成功 test release 后派发独立 `lean-verifier`，使用解析后的 runtime model profile。父 Orchestrator 从当前 exact-fingerprint 的本地验证 attempt 注入完整结构化 deferral 清单；按 `plan.md` Test 环境验收矩阵执行全部 P0/P1、跨端路径和所有 `deferred_to_test` 检查，只访问 `allowed_hosts`。每个 deferred 项必须以 `--evidence-json '{"check":"<exact-id>","result":"passed","proof":"<request/result/artifact>"}'` 精确闭环；自由文本命中、跳过或失败结果都不能通过控制器。

Test 交付拓扑标为 `local` 的 Web candidate 不需要 `test_branch`：从其精确 candidate worktree 按 plan 中的命令本地启动，把 API base 指向已经部署完成且 environment revision 已冻结的 test backend，再通过允许的 localhost 与 test host 做黑盒验收。不得把本地 Web 换成未绑定 candidate 的主 checkout。

结果写入 `plan.md`，不得创建 test-cases/test-report/acceptance/BUG 文档。父 Orchestrator 调 `recordTestVerification()` 将结果绑定当前 attempt/environment revision：通过进入 `TEST_VERIFIED`，真实产品失败进入 `TEST_VERIFY_FAILED`。若部署已成功但浏览器、登录/MFA、人工环境配置或其他验收能力不可用，调用 `record-test-verification --manual-required` 进入可恢复的 `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`，不得当成代码失败，也不得回滚已完成的 test 交付。人工补证后可用同一 attempt 记录 passed 并继续。
