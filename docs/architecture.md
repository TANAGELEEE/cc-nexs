# cc-nexs 架构（monorepo + dist 双层）

## 顶层视角

```
cc-nexs/                    monorepo 根
├── packages/               源码层
│   ├── core/               框架：状态机、角色注册、reviewer 适配、hooks、i18n
│   └── preset-*/           预设：声明角色清单 + 工具映射 + 栈检查 + 模板
├── scripts/build.mjs       build：core 物化进每个 preset
├── dist/                   分发产物（git ignore）
│   ├── .claude-plugin/marketplace.json
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

文本类文件路径 rewrite：
  "core/lib/X" → "lib/X"
  "_core/X"    → "X"
  "../core/X"  → "X"
```

`dist/.claude-plugin/marketplace.json` 自动汇总所有 preset 作为 plugin 列表。

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
   - preset-nexs 的 /cc-nexs:planner / sa / dev / qa / evaluator
   - preset-minimal 的 /cc-nexs:planner / dev / review
   │
   ▼
6. 阶段命令通过 reviewer-adapter.mjs 选择工具：
   - tool=claude-subagent → 用 Task 工具调子代理
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
  → { project, preset, presetRoot, projectRoot, locale, mergedThresholds }
```

读两份 YAML / JSON：项目级（`cc-nexs.config.yml`）+ preset 级（`preset.yml`）。
零依赖手写 YAML 解析器，支持 key:value、嵌套、数组、null/bool/int。

### `core/lib/state-machine.mjs`

纯函数。无 I/O，无副作用。给定 `(state, counters, thresholds, enabledRoles, sprint, humanGateApproved)`，决定下一步。

特点：
- 三档熔断（review_revision / fix_per_bug / evaluator_reject）
- 角色弹性（缺 evaluator 时 reviewer 兼任，缺 qa 时 reviewer 兼任）
- 唯一 stop 条件：`SPEC_PENDING_HUMAN` 且未人工放行

### `core/lib/role-registry.mjs`

从 preset.yml 解析角色定义，结合 core 默认值。提供 `get(name)` 拿到 `{agent, agentPath, tool, alias}`。

### `core/lib/reviewer-adapter.mjs`

`planReviewerInvocation({tool, prompt, diffFile?, customTemplate?})` 返回 `{tool, mode, command|instruction}`。
mode=bash 时给出 shell 命令；mode=task 时给出子代理调用提示。

### `core/lib/progress-io.mjs`

读 / 改 progress.md。原则：
- 只改 yaml 块的字段（current_state / updated_at / approved_at / approver）
- 历史轨迹只追加不重写
- 文件其余 prose 部分原样保留

### `core/lib/i18n.mjs`

`loadI18n({locale, presetRoot})` 返回 `{strings, t(path)}`。
deep-merge core 的 zh-CN.json / en-US.json 与 preset 的 i18n/<locale>/strings.json，preset 覆盖 core。

### `core/hooks/*.mjs`

跨平台 Node.js hook（取代 v0.1 的 bash hook）：

- `role-boundary-guard.mjs` 按 `CC_NEXS_ROLE` 拦截越权读 / 写 / 命令
- `approval-gate-guard.mjs` `SPEC_PENDING_HUMAN` 状态拦截推进性命令
- `pre-merge-check.mjs` 合并主干前跑 build_cmd + 检查 progress=COMPLETE

通过 stdin JSON 协议接收工具调用入参，exit 0 放行 / 2 阻断。

## 状态机骨架（保留 v0.1 设计）

```
INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING
       │                                │
       │                ┌───────────────┴──────────────┐
       │                │ NEEDS_REVISION               │ PASS
       │                ▼                              ▼
       │          SPEC_NEEDS_REVISION          SPEC_PENDING_HUMAN  ⏸️ 唯一人工 gate
       │                │                              │
       │                └────► SPEC_DRAFTED            │ /cc-nexs:approve-spec
       │                                               ▼
       │                                        SPEC_APPROVED
       │                                               │
       ▼                                               ▼
                                       for N in 1..total_sprints:
                                          SPRINT_<N>_KICKOFF
                                               ↓
                                          SPRINT_<N>_DEV
                                               ↓
                                          SPRINT_<N>_REVIEW (代码评审)
                                               ↓ PASS
                                          SPRINT_<N>_TEST
                                               ↓ 有 BUG
                                          SPRINT_<N>_FIX → SPRINT_<N>_REGRESSION
                                               ↓ 全 VERIFIED
                                          SPRINT_<N>_EVAL
                                               ↓ 通过
                                          SPRINT_<N>_DONE
                                               ↓
                                       ALL_SPRINTS_DONE → FINAL_EVAL → COMPLETE
```

熔断箭头（不在主图）：
- review_revision >= 3 → SPEC_REVIEWING（强制 Planner 重审）
- fix_per_bug >= 3 → TECH_LEAD_REVIEW（实现路径重评）
- evaluator_reject >= 2 → SPEC_REVIEWING（AC 或方案严重偏离）

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
- Orchestrator → progress.md

不变量：
- spec.md 只能 Planner 改
- progress.md 只能 orchestrator + approve-spec 改
- 各 review/test/acceptance md 只能 append，不能 overwrite

## 与上一版（v0.1 monolith）对比

| 维度 | v0.1（preset-nexs 单体）| v0.2 monorepo |
|------|------|------|
| 工程结构 | 单 plugin | core + 多 preset |
| 配置 | 硬编码项目规则 | preset.yml 声明，core 读取 |
| Hook | bash | Node.js 跨平台 |
| 角色 | 写死五方 | preset 声明启用哪些 |
| 工具 | 写死 codex | reviewer-adapter 抽象多种 |
| i18n | 中文写死 | core + preset 双层覆盖 |
| 添加新栈 | 改源码 | 写新 preset，core 不动 |

v0.1 的所有 SOP 行为在 v0.2 里通过 `preset-nexs` 完整保留。用户视角零变化。
