---
description: "可选需求澄清入口：补全 requirements.md；需求完整时直接进入当前模式的规划步骤。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Bash"
argument-hint: "<需求编号>"
---

# /cc-nexs:brainstorm

使用 [brainstorming skill](../skills/brainstorming/SKILL.md) 澄清指定需求。此命令不增加独立审批点。

1. 要求明确的需求编号；从 workspace 配置的 docs repository 和 progress assignment 定位唯一需求目录，优先校验 `CC_NEXS_REQ_DIR`。不得通过第一个 glob 匹配猜选目录。
2. 读取 requirements.md、config.json 和权威 progress.json。缺文件、模式不一致或仅有 progress.md 时，报告具体问题；历史状态先走 migrate-progress，不从 Markdown 猜状态。
3. 仅在 `INIT` 且没有已批准范围时编辑需求。Lean 在 RELEASE_PENDING_HUMAN 时走 request-release-changes 的 scope 路径；其他状态返回当前模式的规划变更入口，不在本命令修改批准范围，不用交互式 shell `read` 绕过门禁。
4. 按 skill 补全 requirements.md。问题已清楚时直接形成草稿；不强制提问、方案对比或逐节确认。
5. 返回文件路径、关键缺口及模式对应的下一步：Lean 为 `/cc-nexs:plan <id>`，Fast/Full 为 `/cc-nexs:run <id>`。已授权继续且无关键缺口时执行下一步；否则本次脑暴到此完成。

输出只写 requirements.md，不创建附加设计文档，不修改 progress.json/progress.md。单文件文案修复不需要本命令；Hotfix 使用独立 hotfix 流程。
