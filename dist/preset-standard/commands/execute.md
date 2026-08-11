---
description: "Lean 实现入口。按 plan 任务和路径所有权并行实现，不负责 Git mutation。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号] [--phase=implement|review-fix|test-fix|gateway-b-fix|base-sync]"
---

# /cc-nexs:execute

仅用于 `mode=lean` 且计划已批准。读取 plan task DAG，按波次派发独立 `lean-developer`：

- 在派发任何 child 前，从同一份已批准 plan/progress/config 快照解析并冻结本轮所有 Developer runtime；禁止先启动错误模型再中止重派。
- 打印并核对每个冻结结果的 `{runtime, role, profile, model, effort|reasoning_effort|thinking, fallback}`；实际 child 参数不一致时必须在任何写入前拒绝派发。角色执行期间不因文档 revision 变化而中断，只在下一阶段边界重新解析。
- 只有允许修改路径不重叠的任务可并行；重叠任务串行。
- 每个 child 只收到自己的 AC、task、worktree、允许路径和验证命令。
- child 禁止 Git mutation，只返回精确修改路径和检查结果。
- Orchestrator 校验每个 child 的路径；同一仓库所有实现波次完成后再调用一次 Git Custodian 形成单一 candidate，不按任务/波次反复提交 candidate。每仓 feature branch 固定为 `feature/<id>-<slug>`。
- 实现前/修复后先用 Custodian prepare 同步最新 base；base 变化必须重新本地验证、Review 闭环和 test 发布。
- `review-fix` 只处理集中 Review 的 P0/P1 编号；`test-fix` 只处理 test 环境失败；禁止顺手重构。
- `gateway-b-fix` 只处理 `plan.md` 当前 Gateway B implementation request 的 AC 和允许路径；发现需求/AC/批准方案变化必须停止并改走 scope request。

Fast-track 约束：

- 只运行 plan 指定的定向检查，优先复用/扩展最近的既有测试；除非没有可放置关键回归的现有文件，否则不新增测试文件。
- 同一个已确认的基线 Maven/Nexus/外部依赖阻断只记录一次，不得反复下载、重跑或让多个 child 重复证明。
- compile/unit/lint 的真实失败必须修复；只有明确依赖本地不可用基础设施的 start/smoke/E2E 才能按 driver 契约记为 `deferred_to_test`，并写出 test 动作。不得把代码失败伪装为 deferred。
- 未配置 local driver 时，不新增一次性项目脚本：父 Orchestrator 直接运行 plan 已批准的命令，并用 `verify-local --passed|--deferred-to-test --evidence-json` 绑定真实 command/exit_code/proof；至少一个命令必须实际通过。
- 不做 AC 外重构、通用化或“顺便加固”。发现值得做但非必需的改进，记录 follow-up 后继续当前交付。

任何 requirements 或 `APPROVAL-SCOPE` 变化使 Plan Gate 失效并停止。
