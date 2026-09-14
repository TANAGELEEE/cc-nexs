---
name: "role-isolation"
description: "核对当前 cc-nexs 角色的读写边界与独立会话要求；适用于已派发的 SOP 角色。"
disable-model-invocation: true
---

# 角色边界

先确定当前模式与派发角色，再读取对应 agent 文件及其读写契约。角色注册与运行时选择由 `lib/role-registry.mjs`、`lib/runtime-resolver.mjs` 和 preset.yml 解析；不要从历史角色名称推断固定模型或工具。

- 实现、Review、黑盒验证保持独立会话。黑盒角色只使用其契约允许的输入；规划角色是否可读源码以当前 agent 为准。
- 只在 progress.json 分配的 worktree 和允许路径内写入。角色不改权威状态；Git mutation 遵循 `rules/git-custodian-boundary.md`。
- 开始任务或任务范围改变时核对边界，不要求每次工具调用重复口头自检。
- 发现越界时停止受影响操作，向 Orchestrator 返回路径与事实。保留现有改动，不直接 `git restore` 或改写 progress 来掩盖问题；由正确责任方区分本轮改动与他人改动后修复。

`hooks/role-boundary-guard.mjs` 使用 `CC_NEXS_ROLE` 执行运行时检查；未启用 hook 不代表边界失效。该限制只适用于当前角色，不把 SOP gate 扩展成父会话的全局工具锁。
