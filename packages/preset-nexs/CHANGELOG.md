# Changelog

All notable changes to cc-nexs will be documented here.

## [Unreleased]

### 新增

- **per-feature README 自动同步**：每次 orchestrator 状态推进后自动调 `syncFeatureReadme(...)` 刷新 `doc/<id>/README.md` 的 AUTOGEN 区段（当前状态 / 产物索引 / 契约覆盖快照 / 待人工接入），兑现 README 模板"进入目录第一件事：读本文件"的承诺。
  - 新文件：`packages/core/lib/readme-sync.mjs` + 单测
  - templates/README.md 重组：加 `<!-- AUTOGEN:status START/END -->` 锚点；"下一步动作"小节移到锚点外人工维护
  - 触发点：`/cc-nexs:run` 的 transitionState 之后、human gate 之前、COMPLETE 之前；`/cc-nexs:init` 完成后种入初始 README
  - **向后兼容**：旧 README 没有 AUTOGEN 锚点 → readme-sync 自动跳过 + warn，不强改
  - **失败安全**：sync 出错只 console.warn，不阻塞主流程
  - **idempotent**：再次跑无变化时 return `no_change`，不写文件（避免 git 噪音）
  - tech-lead-claude.md 反模式加"禁手动编辑 AUTOGEN 区段"
- **`docs/solutions/` 复利沉淀机制**：新增 `compound` 旁路角色 + `/cc-nexs:compound <id>` 命令，需求收尾后把"非显然教训"沉淀到仓库级 `docs/solutions/<topic>.md`。下次同类需求 RECON 阶段 Repo Scout 自动 grep `frontmatter.keywords` 命中、摘进 repo-context.md `## 7.6 既往教训命中`，Planner 第一稿就避坑——这是 cc-nexs 复利的字面定义。
  - 新文件：`agents/compound-claude.md`、`commands/compound.md`、`templates/solution.md`
  - **强信号过滤**：必须满足"同 BUG 修 ≥ 2 次 / SA 反馈跨 sprint 重复 / RECON 推翻 / 验收驳回 / spec 变更 ≥ 3 行"任一才产出 solution；不命中**禁强写**，在 compound-summary.md 写"跳过"
  - **dedupe by frontmatter.slug**：同 topic 多次需求触发 → Edit 既有文件追加观察，不新建
  - 旁路命令，**不入状态机**——支持回溯历史需求（`--force` 跳过 COMPLETE 校验），保持状态机简单
  - run.md COMPLETE 输出加一行"💡 建议跑 /cc-nexs:compound"提示，但不强制
- **AGENTS.md / CLAUDE.md grounding**：Repo Scout 工作流程加 step 1.5，扫描项目根 AGENTS.md（优先）/ CLAUDE.md（fallback），把项目级强制约定（命名/注入/禁用 API 等）摘进 repo-context.md `## 7.5 项目级强制约定`。让 Planner 设计 spec 时不撞项目级强制规则。
- **RECON 阶段（现状勘察）**：在 Planner 起草 spec 之前，新增 `repo-scout` 角色独立 session 扫 src/ 产 `repo-context.md`（同类配置/Service/Mapper/页面/API/DTO 的事实清单）。Planner 仍守"禁读 src/"铁律，但通过 repo-context.md 间接获得现状信息，避免在真空里设计与现有工程脱节的 spec。
  - 新文件：`agents/repo-scout-claude.md`、`templates/repo-context.md`、`commands/recon.md`
  - 状态机（full 模式）：`REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED`，`SPEC_NEEDS_REVISION` 不重跑 recon
  - fast 模式：recon 折叠到 `/cc-nexs:fullstack --phase=spec` 前置 sub-step，状态机不暴露 RECON_DONE
  - spec.md 模板"影响范围"硬性新增"现状对照"小节（复用 / 扩展 / 新建 + 理由 + 冲突点）
  - **向后兼容**：当 preset 未启用 `repo-scout` 角色时，`REQ_DRAFTED` 直接跳 `SPEC_DRAFTED`（旧行为）
- `using-worktrees` skill（`packages/preset-nexs/skills/using-worktrees/SKILL.md`）：检测当前是否已在 worktree → `git worktree add .worktrees/<id>-<slug>` → 自动给宿主仓库加 `.gitignore` → 创建 `feature/<id>-<slug>` 分支。针对 cc-nexs 做了三处特别处理：固定 `.worktrees/` 路径（不用 Claude Code 内置 EnterWorktree 的 `.claude/worktrees/`）、嵌套 init refuse、gitignore 自动 commit。
- `/cc-nexs:build` 命令 + `lib/build-selector.mjs`：按 git diff 自动选 build/test 命令。`cc-nexs.config.yml` 新增 `paths_override.modules[]` 字段，每个 module 含 `name`、`match`（glob 数组）、`build_cmd`、`test_cmd`。selector 用 `git diff <diff_base>...HEAD` + `git status --porcelain` 取改动文件，按 module 的 glob 匹配；命中模块按 yml 顺序串行跑命令，未命中回退 `paths_override.build_cmd` / `test_cmd` 顶层。
  - 跨模块改动会顺序跑命中的所有模块；任一失败 fail fast。
  - 顶层 `build_cmd` 留空 = 仅文档/无源码改动时不跑构建。
  - `paths_override.diff_base` 默认 `main`，主分支叫别的（`master`、`develop`）需覆盖。
  - 用法：`/cc-nexs:build [--phase=build|test|both] [--dry-run]`。

### 修复

- `lib/config-loader.mjs::parseYaml` 重写为递归下降。原栈机版本在嵌套 array-of-object（如 `forbidden_patterns:` + `excludes:` 数组、`modules:` + `match:` 数组）会崩，但因 loader 此前未在 orchestrator 关键路径调用，bug 一直未暴露。修复后能正确解析 `preset-nexs/preset.yml` 的所有结构，新增能力：inline flow 数组（`["a","b"]`）、字符串里的 `#` 不再被当注释切掉。

### 变更

- **BREAKING（默认行为）**：`/cc-nexs:init` 默认在 `<repo>/.worktrees/<id>-<slug>/` 建独立 git worktree，多需求可并行开发；不再在当前目录直接 `git checkout -b`。
  - `--no-worktree` 退回旧行为
  - 在 worktree 内禁止再次 init（一个 worktree 对应一个需求）
- `/cc-nexs:run` 增加 Step -1：检测 cwd 是否在期望的 `.worktrees/<id>-*` 内；不在 → 拒绝并提示 `cd`。`--no-worktree` 创建的需求不受影响。
- `/cc-nexs:run` 在 `COMPLETE` 时打印手动 worktree 清理指令（`git worktree remove`），不自动清理。

### 迁移指引

老用户继续走旧 `git checkout -b` 流程：所有 `init` 命令加 `--no-worktree`。或在 `cc-nexs.config.yml` 配置默认值（暂未实现，可后续添加）。

## [0.3.0-dev] - 2026-05-22

新增 **fast 模式**：单 sprint 三角色合并流水线，比 full 模式少 ~50% 子代理调用，适合单接口/单模块小改动。

### 新增

- 3 个合并角色：
  - `fullstack-claude`（合并 Planner + Tech Lead）：一手包办 spec 起草 + 编码 + 文档同步 + bug 修复
  - `reviewer-codex`（合并 SA 代码评审 + Evaluator 契约验收）：单次 codex 调用同时产 sa-code-review.md + acceptance.md
  - `verifier-codex`（合并 QA cases + run + regression）：首次调用同时产 test-cases.md + test-report.md
- 3 个 slash commands：`/cc-nexs:fullstack` / `/cc-nexs:review` / `/cc-nexs:verify`
- preset.yml 新增 `modes:` 顶层字段，声明 full / fast 两种模式的 enabled + state_machine + thresholds_override
- core/lib/state-machine.mjs 新增 `mode='fast'` 分支：状态序列 `BUILD → TEST → [FIX → REGRESSION]* → ACCEPT → COMPLETE`，无 SPRINT_<N>_* 命名（强制单 sprint）
- core/schemas/preset.schema.json 新增 `modes` 校验
- templates/config.json 在 `_mode_options` 增加 fast 选项与选择建议（`_mode_选择建议`）
- templates/progress.md 状态机字典拆成 full / fast 两套表

### 变更

- preset.yml 版本 `0.2.0-dev → 0.3.0-dev`，描述补充 "支持 full / fast 两种模式"
- run.md 增加 Step 0.5（解析 mode）+ 角色 → 命令 dispatch 表（按 mode 分列）+ fast 模式合并解析章节（state=ACCEPT 后同时解析两个 md）
- fast 模式熔断阈值更严：`review_revision: 2` / `fix_per_bug: 2`（full 模式仍是 3 / 3）；同 BUG 修 2 次直接停下要人工，没有 TECH_LEAD_REVIEW 兜底岗

### 选择建议

| 用 full 当 | 用 fast 当 |
|---|---|
| 跨模块、含 DB schema 变更 | 单模块单接口 |
| 涉及对外契约、合规风险 | 改动 ≤ 800 行 diff |
| Sprint 切片 ≥ 2 | 无并发/事务复杂度 |

## [0.1.0] - 2026-05-17

首次发布。把 v2.1 五方异构 SOP 拆成 Claude Code Plugin 形态。

### 新增

- 9 个 slash commands：run / planner / sa / dev / qa / evaluator / hotfix / approve-spec / status
- 5 个角色 agents：planner-claude / tech-lead-claude / sa-codex / qa-codex / evaluator-codex
- 4 个被动触发 skills：using-cc-nexs / role-isolation / md-aggregation / commit-discipline
- 3 个 PreToolUse hooks：role-boundary-guard / spec-gate-guard / pre-merge-check
- 完整模板集：requirements / spec / dev-plan / test-cases / api-doc / deploy / acceptance / test-report / progress（状态机骨架）/ config / bugs/BUG-template
- 状态机编排：progress.md 驱动的自循环
- 唯一人工 gate：spec 通过 SA 评审后停一次
- 三档熔断：SA review / dev 循环 / Evaluator 未通过
- Hotfix 三档分级：P3 / P2 / P0-P1
