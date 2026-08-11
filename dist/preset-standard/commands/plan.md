---
description: "Lean 默认模式计划入口。并行只读调研，生成唯一 requirements.md 与 plan.md，并停在 Gateway A。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号]"
---

# /cc-nexs:plan

仅用于 `mode=lean`。解析需求目录和 workspace，要求 `requirements.md` 非空且状态为 `INIT` 或 `PLANNING`。

1. 要求 `config.json.config_version=2`；否则停止并提示 `/cc-nexs:migrate-feature-config <id>`。加载 `mergedModels`（public/overlay/project）和独立的 `featureConfig`，不得提前把 feature roles 合进 project models。
2. 用 `resolveRoleRuntime(preset, 'lean-planner', runtime, {models: mergedModels, featureConfig, progress: progressV2, planText})` 解析 profile。首次 `risk_tier:auto` 且尚无计划时使用 routing 默认风险；显式 feature `high|critical` 可在首次派发前升级。
3. 派发且只派发一个独立 Lean Planner。默认直接检索现有实现；只有两个以上互不依赖、且会明显缩短调研的事实问题才并行派只读调研。不得为“更全面”追加第二个 hardening Planner，也不得保存子代理对话。
4. Planner 只维护 `requirements.md` 和 `plan.md`。优先复用项目中已上线的同类能力，禁止把可选加固、通用化重构或未来风险擅自扩大为当前阻塞范围；它们只能列为非阻塞 follow-up。
5. `plan.md` 必须保留 `APPROVAL-SCOPE` markers，并在标记内各写且只写一个：
   - `- risk_tier: low|medium|high|critical`
   - `- delivery_lane: fast-track|standard`
   还必须为每个受影响代码仓写一条机器可解析的 `- test_delivery.<repo-id>: deploy|local`。`deploy` 必须对应 workspace 的 `test_branch`；`local` 必须在验证矩阵中给出从 exact candidate worktree 启动的命令、readiness 和 test backend API-base 注入方式。每个 AC 必须覆盖任务、最小本地检查和 test 检查，任务修改路径不得重叠。
6. 满足以下全部条件时默认 `fast-track`：复用既有能力且不改变其权限模型；无新增表结构/迁移；无新增基础设施、密钥或重大配置；无公开破坏性契约；风险为 low/medium。否则写 `standard` 并给出具体不满足项。Fast-track 的顺序是“实现 → 可执行的定向本地检查 → test 交付/验收 → 集中 Review → Gateway B”；standard 保持 Review 在 test 前。
7. Orchestrator 校验两份文档、唯一 concrete risk、唯一 delivery lane 和最终 route summary 后，用确定性 `transitionState` 记录 `INIT → PLANNING → PLAN_PENDING_HUMAN`。角色不得直接改 progress。高/critical 风险只影响后续 Reviewer 路由或 Full 建议，不得在 Plan 阶段自动再开一轮代理。
8. 输出风险、delivery lane、关键复用点、计划文件和 HTML 渲染入口，停止等待 `/cc-nexs:approve-plan <id>`。Gateway A 将 risk、lane 与 requirements/plan scope hash 一起绑定。

高风险权限/支付/破坏性迁移/公开 API 破坏且无法用一次集中 Review 控制时，Planner 必须建议显式改走 full，不得暗中增加 Review 轮次。

复用项目现有 S3 presign/direct-upload 能力，且不新增 bucket、IAM/CORS、密钥、公开权限或破坏性 API 时，不得只因出现“上传/S3/存储”字样自动判 high。只有这些基础设施、权限或公开契约真的变化时才相应升级风险。
