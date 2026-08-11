# cc-nexs 架构（monorepo + dist 双层）

## 顶层视角

```
cc-nexs/                    monorepo 根
├── packages/               源码层
│   ├── core/               框架：状态机、角色注册、reviewer 适配、hooks、i18n
│   └── preset-*/           预设：声明角色清单 + 工具映射 + 栈检查 + 模板
├── scripts/build.mjs       build：core 物化进每个 preset
├── .claude-plugin/         Claude marketplace（build 生成）
├── .agents/plugins/        Codex marketplace（build 生成）
├── pi/                     手写 extension + build 生成的 agents/skills
├── dist/                   Claude/Codex 分发产物（随 release commit）
│   └── preset-*/           扁平自包含 plugin
└── examples/               真实使用样板
```

**源码 vs 分发**：
- 源码用 monorepo 是因为 core 多 preset 共享，单仓维护清晰
- 分发用扁平是因为 Claude Code plugin 加载机制按 plugin 根目录 auto-discovery，跨目录引用不被识别
- `pnpm build` 把 core 内容物化进 `dist/<preset>/` 解决两者矛盾

## 双层职责划分

| 层 | 职责 | 跨项目通用？ |
|----|------|-------------|
| **core** | 状态机引擎、计数器、熔断、orchestrator commands、hooks 协议、i18n 框架、reviewer 工具适配 | ✅ |
| **preset** | 启用哪些角色、用什么工具、做什么栈检查、加载什么模板、什么语言 | ❌（每项目特化）|

core 不知道有多少种栈，也不知道角色叫什么名字。preset 通过 `preset.yml` 把这些项目特定知识声明出来。

## Build 流程

```
源码 (packages/)              build.mjs 行为                  产物 (dist/<preset>/)
─────────────────────         ───────────────                 ────────────────────
preset/commands/*.md     →   原样拷贝                    →    commands/<preset 自有>
preset/agents/*.md       →   原样拷贝                    →    agents/
preset/skills/           →   原样拷贝                    →    skills/
preset/templates/        →   原样拷贝                    →    templates/
preset/preset.yml        →   原样拷贝                    →    preset.yml
preset/i18n/             →   原样拷贝                    →    i18n/
preset/hooks/hooks.json  →   原样拷贝                    →    hooks/hooks.json
preset/.claude-plugin/   →   plugin.json + 同步 version  →    .claude-plugin/plugin.json

core/commands/*.md       →   skipExisting（preset 优先）→    commands/<core 共享>
core/hooks/*.mjs         →   skipExisting               →    hooks/*.mjs
core/lib/*.mjs           →   原样拷贝                   →    lib/
core/schemas/*.json      →   原样拷贝                   →    schemas/
core/i18n/*.json         →   skipExisting               →    i18n/
commands + agents       →   生成薄 Codex runtime adapter → codex-skills/
standard commands/agents →  生成 Pi runtime adapter      → pi/skills/ + pi/agents/

文本类文件路径 rewrite：
  "core/lib/X" → "lib/X"
  "_core/X"    → "X"
  "../core/X"  → "X"
```

根目录 `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 自动汇总所有 preset；`dist/.claude-plugin/marketplace.json` 不是有效入口。

`packages/core/**` 与 `packages/preset-*/**` 是 command/agent 的 source of truth；`dist/**`、`pi/agents/**`、`pi/skills/**` 以及两个根 marketplace 都是 build 产物，禁止手工维护三份。`pi/extensions/cc-nexs.ts` 是手写的 Pi runtime 入口。提交前的生成物检查应覆盖全部这些路径：

```bash
pnpm build
git diff --exit-code -- dist pi/agents pi/skills .claude-plugin/marketplace.json .agents/plugins/marketplace.json package.json.pi
```

## 启动时序

```
用户运行 /cc-nexs:run 01
   │
   ▼
1. core 的 commands/run.md 被 Claude Code 加载（实际从 dist 加载）
   │
   ▼
2. 解析需求目录 doc/01.<slug>/，读取 progress.md.current_state
   │
   ▼
3. 调 core/lib/config-loader.mjs：
   - 加载项目根的 cc-nexs.config.yml
   - 加载 preset.yml（位置由项目 config 指定，或环境变量）
   │
   ▼
4. 调 core/lib/state-machine.mjs::nextStep(...)
   - 输入：current_state、counters、enabledRoles、thresholds、sprint
   - 输出：{ next, role, action, parallel?, stop?, circuitBreaker? }
   │
   ▼
5. 根据 role 调对应阶段命令（preset 提供）：
   - preset-standard 的 /cc-nexs:planner / sa / dev / qa / evaluator
   - preset-minimal 的 /cc-nexs:planner / dev / review
   │
   ▼
6. 阶段命令通过 reviewer-adapter.mjs 选择工具：
   - tool=claude-subagent → 用 Task 工具调子代理；Claude Code 的 Lean 四角色均走此路径
   - tool=codex → 用 Bash 工具调 codex CLI
   - tool=gemini / openai-cli / custom → 类似
   │
   ▼
7. 阶段完成 → 解析输出文件结论行 → progress-io.mjs 写新状态
   │
   ▼
8. 立即回到 step 4 自循环（除非 stop=true 或 next=COMPLETE）
```

## 关键模块

### `core/lib/config-loader.mjs`

```js
loadConfig({ projectRoot, presetRoot? })
  → { project, preset, overlay, locale, mergedThresholds, mergedStack, mergedWorkflow, mergedRelease, mergedModels }
```

读两份 YAML / JSON：项目级（`cc-nexs.config.yml`）+ preset 级（`preset.yml`）。
零依赖手写 YAML 解析器，支持 key:value、嵌套、数组、null/bool/int。

### `core/lib/state-machine.mjs`

纯函数。无 I/O，无副作用。给定 `(state, counters, thresholds, enabledRoles, sprint, humanGateApproved)`，决定下一步。

特点：
- `mode=lean` 为新需求默认；fast-track 顺序是 plan gate、本地可执行验证、test 交付/验收、一次集中 Review、release gate、base merge
- 三档熔断（review_revision / fix_per_bug / evaluator_reject）
- 角色弹性（缺 evaluator 时 reviewer 兼任，缺 qa 时 reviewer 兼任）
- 默认 stop：`SPEC_PENDING_HUMAN`（G1）；manual/legacy G2、test release block、manual verification 和熔断

### `core/lib/test-release.mjs`

把不可变 candidate ref 按仓库顺序合入最新 `origin/<test_branch>`，普通 non-force push 后调用结构化 test release driver，并把 integration/pipeline/deployment/environment_revision 写入 progress v2 attempt。controller 只允许 test，不处理生产。

### `core/lib/role-registry.mjs`

从 preset.yml 解析角色定义，结合 core 默认值。提供 `get(name)` 拿到 `{agent, agentPath, tool, alias}`。

### `core/lib/model-routing.mjs`

把三端共用的模型决策集中在确定性核心：校验 `risk_tier` / Hotfix severity / `models.routing`，从 Gateway A binding 或 Hotfix scope 取可信风险信号，按最高风险匹配规则，再把 feature `models.roles` 作为最终显式覆盖。`resolveFeatureModelRouting()` 和 `resolveRoleRuntime()` 同时返回 matched rules、全部信号、是否自动升档以及最终 profile/model/effort，避免 Claude Code、Codex、Pi 各自实现一套优先级。

Lean 只派一个 Planner；`risk_tier:auto` 的首稿由日常 profile 生成，high/critical 只升级后续 Reviewer 并在 Gateway A 建议 Full，不再冷启动第二个 Planner。Gateway A 将 concrete risk、delivery lane 与批准范围 hash 一起绑定；fast-track 只允许 low/medium。历史 binding 没有 risk 时，仅从 `plan_scope_sha256` 完全匹配的批准范围派生；无法验证或没有 concrete risk 时按 high 保守升档。旧计划没有 lane 时安全解释为 standard。可用 `migrate-feature-config --bind-plan-risk` 显式回填可证明的旧 binding，绝不从范围外文本或模型猜测。

### `core/lib/reviewer-adapter.mjs`

`planReviewerInvocation({tool, prompt, diffFile?, model?, effort?, fallbackModels?})` 返回结构化 argv 或原生子代理计划。Claude/Codex/Pi 的角色模型可由私有 project/feature config 覆盖；Reviewer 可与实现使用不同模型，也可使用相同模型和更高 effort/thinking。

### `core/lib/progress-io.mjs`

读 / 改 progress.md。原则：
- 只改 yaml 块的字段（current_state / updated_at / approved_at / approver）
- 历史轨迹只追加不重写
- 文件其余 prose 部分原样保留

### `core/lib/docs-reservation.mjs`

实现跨开发者可见的两阶段 docs 协议。init 阶段先从最新远端 docs base 竞争分配编号，只允许在 detached 临时 worktree 新建 `doc/<id>.<slug>/README.md` 和 reservation marker，然后普通 fast-forward push；不允许修改既有路径或 force push。自动编号遇到并发更新会重新 fetch、换号重试。最终代码合并后，完整需求文档作为第二阶段 candidate 合入 docs。

### `core/lib/i18n.mjs`

`loadI18n({locale, presetRoot})` 返回 `{strings, t(path)}`。
deep-merge core 的 zh-CN.json / en-US.json 与 preset 的 i18n/<locale>/strings.json，preset 覆盖 core。

### `core/hooks/*.mjs`

跨平台 Node.js hook（取代 v0.1 的 bash hook）：

- `role-boundary-guard.mjs` 按 `CC_NEXS_ROLE` 拦截越权读 / 写 / 命令
- Lean Gateway A/B 与 legacy G1/G2 由状态机返回 `stop: true` 暂停角色派发；不使用全局 PreToolUse 封锁。审批只能通过 `cc-nexs approve-*` 核心命令记录事件和推进状态
- `pre-merge-check.mjs` 合并主干前跑 build_cmd + 检查 progress=COMPLETE

通过 stdin JSON 协议接收工具调用入参，exit 0 放行 / 2 阻断。

## 状态机骨架

Lean 默认：

```text
INIT → PLANNING → PLAN_PENDING_HUMAN
→ IMPLEMENTING → LOCAL_VERIFYING → TEST_RELEASE → TEST_VERIFYING
                                  ↘ TEST_DEPLOYED_NEEDS_MANUAL_VERIFY ↗
→ CONSOLIDATED_REVIEW → RELEASE_PENDING_HUMAN
→ BASE_MERGING → COMPLETE
```

Lean 只维护 requirements.md 和 plan.md 两份人工文档；Review 阻塞后最多一次 delta closure。无法本地启动的环境项以 `deferred_to_test` 留证并继续交付。浏览器、登录/MFA 与验收 URL 只在部署后检查，缺失时进入可恢复的 `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`，不会回滚 test merge/CI。

Legacy full：

```
INIT → REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED → SPEC_REVIEWING
     → SPEC_PENDING_HUMAN (G1) → SPEC_APPROVED

for N in 1..total_sprints:
  KICKOFF → DEV + QA_CASES → SA_TEST_REVIEW → DOC_SYNC → SA_CODE → DEV_DONE

ALL_SPRINTS_DEV_DONE → INTEGRATION_REVIEW → TEST_RELEASE
                     → FINAL_QA → FINAL_EVAL → COMPLETE

FINAL_QA_BLOCKED → FINAL_FIX → FINAL_FIX_REVIEW → TEST_RELEASE → FINAL_QA
```

Sprint 是开发切片，不是部署/验收切片。新需求默认 `final_only + auto_if_ready`；旧 progress 无 delivery 时保持 `per_sprint + manual`。显式退出、release driver 或 test branch 配置错误可以在 push 前阻止交付；browser/login/MFA/verification URL 只影响部署后验收并进入可恢复的 manual verification。生产发布始终人工。

熔断箭头（不在主图）：
- review_revision >= 3 → SPEC_REVIEWING（强制 Planner 重审）
- fix_per_bug >= 3 → TECH_LEAD_REVIEW（实现路径重评）
- evaluator_reject >= 2 → integration/spec 方案重评

## 数据流

进入 cc-nexs 的输入：
- `requirements.md` 由人填
- 项目 `cc-nexs.config.yml` 由人配置一次

流转产物（按角色）：
- Planner → spec.md
- Reviewer → review.md / sa-review.md / sa-code-review.md / sa-test-review.md
- Developer → src/* + dev-plan.md + api-doc.md + deploy.md
- QA → test-cases.md + test-report.md + bugs/ + qa-scripts/
- Evaluator → acceptance.md
- Orchestrator/core controls → progress.json v2 + progress.md mirror

不变量：
- spec.md 只能 Planner 改
- progress 只能 orchestrator + deterministic approve/release controls 改
- 各 review/test/acceptance md 只能 append，不能 overwrite

## 与上一版（v0.1 monolith）对比

| 维度 | v0.1（preset-standard 单体）| v0.2 monorepo |
|------|------|------|
| 工程结构 | 单 plugin | core + 多 preset |
| 配置 | 硬编码项目规则 | preset.yml 声明，core 读取 |
| Hook | bash | Node.js 跨平台 |
| 角色 | 写死五方 | preset 声明启用哪些 |
| 工具 | 写死 codex | reviewer-adapter 抽象多种 |
| i18n | 中文写死 | core + preset 双层覆盖 |
| 添加新栈 | 改源码 | 写新 preset，core 不动 |

v0.1 的所有 SOP 行为在 v0.2 里通过 `preset-standard` 完整保留。用户视角零变化。
