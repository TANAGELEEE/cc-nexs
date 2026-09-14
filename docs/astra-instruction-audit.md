# GPT-6 Astra 指令审计

核对日期：2026-09-07。范围为当前仓库的指令源、生成适配层与交付工作流；不修改用户全局配置、已安装插件缓存或既有 feature 配置。

## 官方依据

- [GPT-6 Astra 模型指导](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)：模型对技能和指令文件更敏感；应明确持续执行、必要澄清、有效委派及适度验证的边界。本次据此清理额外停顿和相互冲突的规则。
- [AGENTS.md 指导](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：项目指令按目录分层加载。本次新增简短的根级维护契约，区分仓库维护与被打包的 SOP 角色指令。
- [技能指导](https://learn.chatgpt.com/docs/build-skills)：名称与描述先进入发现上下文，正文按需加载。本次缩短镜像描述，保留已有显式调用策略，继续以 commands 为流程来源。

## 审计范围与处理

清点 10 个源 SKILL.md、37 个源 command、20 个源 agent，以及 core rules、标准 workflow、模板、模型路由配置、生成器和 GitHub CI。跨目录检索审批、暂停、角色隔离、输出限额、历史改写与模型路由要求；重点逐项核对冲突来源及其调用位置。dist 和 Pi 镜像由构建同步，不作为独立指令源编辑。

| 问题 | 处理 | 保留的契约 |
|---|---|---|
| 根目录缺少 AGENTS.md，维护时容易把产品角色当作当前身份 | 新增源码地图、任务边界和验证入口 | 用户显式调用的 SOP 仍按原流程执行 |
| 脑暴技能要求所有任务必经、逐节确认，与命令的可选语义冲突 | 改为关键缺口澄清；完整草稿一次交付；有授权则继续对应模式的规划 | 只写 requirements；不改批准范围或权威状态 |
| 脑暴命令读取 progress.md 并允许 shell 确认越过状态限制 | 读取 progress.json；明确 Gate B scope controller 的适用状态 | 不把非 Gate B 状态误送入该 controller |
| commit 数量上限和 Sprint squash 会改变 candidate 历史 | 删除硬配额、rebase 示例及重复审批提示，同步 spec 模板 | Git Custodian、不可变 candidate、重新验证 |
| 身份技能重复旧五方矩阵，引用不存在的 .sh hook，并建议 git restore | 指向当前角色契约与 .mjs hook；按具体变更归属修复 | 独立 Review、黑盒角色读写边界、保护他人改动 |
| 统一 2000 字符和五项上限可能截断 finding；角色重复抄写风格规则 | 输出规则集中维护，长度服从证据完整度 | 机器结论行、AC、candidate、attempt 绑定 |
| 文档聚合把 Fast/Full 文件清单推广到所有模式 | 明确 Lean 写 plan、Hotfix 写 hotfix，删除通用 tail/grep 状态推断 | 历史轮次与当前 candidate 证据 |
| 完成后无条件输出经验沉淀提示 | 只在有具体可复用教训或用户要求时提示 | 完成定义和最终交付摘要 |
| 模型说明容易将高风险升档理解为再次启动 Planner | 区分首次显式风险升档与计划发现风险后的 Reviewer 升档 | 单 Planner、现有 resolver、feature override 优先 |

## 保留与适配

保持 public preset 的 inherit 模型和风险分档。Astra 可由当前宿主选择，或在支持该模型的私有 profile 中设置；medium / high / xhigh 是现有起点，应按真实任务评估，不统一改成最高推理档位。具体配置入口见 [Codex 插件说明](codex-plugin.md)。

保持四种模式状态机、Gateway A/B、旧 G1/G2、同仓写入串行和跨仓 wave barrier。它们承担可验证的交付约束，不能作为冗余文本删除。简短 branch/worktree/merge 兼容技能保留。历史 CHANGELOG 和任务记录保留原貌。

GitHub CI 保留 Node 20/22 和 Windows 覆盖。此次改变的是提示、模板与适配描述，没有证据支持删除平台兼容性检查。构建、可复现校验和安装 smoke 会重建共享生成目录，执行时应串行，避免校验读到中间状态。

## 验证与效果边界

- 233 项核心测试通过，覆盖状态机、审批绑定、模型路由、candidate、release 与 worktree 边界。
- 13 项安全及版本一致性测试通过。
- 三端插件验证、SOP parity、runtime portability 与隔离安装 smoke 通过。
- 可复现构建通过，包含 LF/CRLF 源码一致性。
- 静态场景复核：简单文案不进入脑暴；完整需求无额外问答；只请求脑暴交付草稿后结束；批准范围变化不直接实现；代码变化不复用旧 PASS；长评审保留完整 finding。

五个重点文件（脑暴 command/skill、commit skill、role-isolation skill、output rule）由 14,727 个 Unicode 字符降至 3,430 个，减少 76.7%。这只是文本长度变化，不等于 token、延迟或成功率提升。此次未运行真实 Astra A/B 行为评测，也未执行生产交付。

后续评测应固定模型、effort、任务输入和验收标准，比较修改前后的无必要确认次数、工具调用、用时、token、AC 通过率与门禁违规情况；不要只以字数下降判断质量。
