# cc-nexs Architecture（monorepo + dist dual-layer）

## Top-Level View
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
**Source vs. distribution**:
- Source uses a monorepo because core is shared across multiple presets, keeping a single repo clean to maintain
- Distribution uses a flat layout because the Claude Code plugin loading mechanism auto-discovers by plugin root directory, and cross-directory references aren't recognized
- `pnpm build` materializes core content into `dist/<preset>/`, resolving the conflict between the two

## Two-layer responsibility split

| Layer | Responsibility | Shared across projects? |
|----|------|-------------|
| **core** | State machine engine, counters, circuit breaking, orchestrator commands, hooks protocol, i18n framework, reviewer tool adapters | ✅ |
| **preset** | Which roles are enabled, which tools to use, what stack checks to run, which templates to load, what language | ❌（specialized per project）|

core doesn't know how many kinds of stacks exist, nor what the roles are called. The preset declares this project-specific knowledge through `preset.yml`.

## Build flow
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
The root `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` automatically aggregate all presets; `dist/.claude-plugin/marketplace.json` is not a valid entry point.

`packages/core/**` and `packages/preset-*/**` are the source of truth for commands/agents; `dist/**`, `pi/agents/**`, `pi/skills/**`, and the two root marketplaces are all build artifacts, and the three copies must not be maintained by hand. `pi/extensions/cc-nexs.ts` is the hand-written Pi runtime entry point. The generated-artifact check before committing should cover all of these paths:
```bash
pnpm build
git diff --exit-code -- dist pi/agents pi/skills .claude-plugin/marketplace.json .agents/plugins/marketplace.json package.json.pi
```
## 启动顺序
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
## Key Modules

### `core/lib/config-loader.mjs`
```js
loadConfig({ projectRoot, presetRoot? })
  → { project, preset, overlay, locale, mergedThresholds, mergedStack, mergedWorkflow, mergedRelease, mergedModels }
```
Read two YAML / JSON files: project-level (`cc-nexs.config.yml`) + preset-level (`preset.yml`).
Zero-dependency hand-written YAML parser, supporting key:value, nesting, arrays, null/bool/int.

### `core/lib/state-machine.mjs`

Pure function. No I/O, no side effects. Given `(state, counters, thresholds, enabledRoles, sprint, humanGateApproved)`, decides the next step.

Characteristics:
- `mode=lean` is the default for new requirements; the fast-track order is plan gate, locally executable verification, test delivery/acceptance, a single consolidated Review, release gate, base merge
- Three-tier circuit breaker (review_revision / fix_per_bug / evaluator_reject)
- Role flexibility (when evaluator is absent, reviewer takes over; when qa is absent, reviewer takes over)
- Default stop: `SPEC_PENDING_HUMAN` (G1); manual/legacy G2, test release block, manual verification, and circuit breaker

### `core/lib/test-release.mjs`

Merges the immutable candidate ref into the latest `origin/<test_branch>` in repository order, then after a normal non-force push calls the structured test release driver, and writes integration/pipeline/deployment/environment_revision into the progress v2 attempt. The controller permits test only and does not handle production.

### `core/lib/role-registry.mjs`

Parses role definitions from preset.yml, combined with core defaults. Provides `get(name)` to retrieve `{agent, agentPath, tool, alias}`.

### `core/lib/model-routing.mjs`

Concentrates the model decisions shared by the three runtimes into a deterministic core: validates `risk_tier` / Hotfix severity / `models.routing`, takes trusted risk signals from the Gateway A binding or Hotfix scope, matches rules by the highest risk, and then applies feature `models.roles` as the final explicit override. `resolveFeatureModelRouting()` and `resolveRoleRuntime()` both return the matched rules, all signals, whether auto-upgrade occurred, and the final profile/model/effort, avoiding Claude Code, Codex, and Pi each implementing their own priority scheme.

Lean dispatches only one Planner; the first draft for `risk_tier:auto` is generated by the daily profile, and high/critical only upgrades the subsequent Reviewer and recommends Full at Gateway A, without cold-starting a second Planner. Gateway A binds the concrete risk, delivery lane, and approved-scope hash together; fast-track only allows low/medium. When a historical binding has no risk, derive it only from the approved scope that exactly matches `plan_scope_sha256`; when it cannot be verified or there is no concrete risk, conservatively upgrade as high. When an old plan has no lane, safely interpret it as standard. `migrate-feature-config --bind-plan-risk` can be used to explicitly backfill provable old bindings, never guessing from out-of-scope text or models.

### `core/lib/reviewer-adapter.mjs`

`planReviewerInvocation({tool, prompt, diffFile?, model?, effort?, fallbackModels?})` returns a structured argv or a native subagent plan. The role models for Claude/Codex/Pi can be overridden by private project/feature config; the Reviewer can use a different model from the implementation, or the same model with higher effort/thinking.

### `core/lib/progress-io.mjs`

Reads / modifies progress.md. Principles:
- Only modify fields in the yaml block (current_state / updated_at / approved_at / approver)
- The historical trail is append-only, never rewritten
- The rest of the file's prose is preserved as-is

### `core/lib/docs-reservation.mjs`

Implements a two-phase docs protocol visible across developers. In the init phase, it first competitively allocates a number from the latest remote docs base, only allowing creation of `doc/<id>.<slug>/README.md` and the reservation marker in a detached temporary worktree, then does a normal fast-forward push; modifying existing paths or force push is not allowed. When automatic numbering encounters concurrent updates, it re-fetches and retries with a new number. After the final code merge, the complete requirements document is merged into docs as the second-phase candidate.

### `core/lib/i18n.mjs`

`loadI18n({locale, presetRoot})` returns `{strings, t(path)}`.
Deep-merges core's zh-CN.json / zh-TW.json / en-US.json with the preset's i18n/<locale>/strings.json, with the preset overriding core.

### `core/hooks/*.mjs`

Cross-platform Node.js hooks (replacing the v0.1 bash hooks):

- `role-boundary-guard.mjs` blocks unauthorized read / write / commands according to `CC_NEXS_ROLE`
- Lean Gateway A/B and legacy G1/G2 return `stop: true` from the state machine to pause role dispatch; no global PreToolUse blocking is used. Approval can only record events and advance state through the `cc-nexs approve-*` core commands
- `pre-merge-check.mjs` runs build_cmd + checks progress=COMPLETE before merging to the main branch

Receives tool-call arguments via the stdin JSON protocol; exit 0 allows / 2 blocks.

## State machine skeleton

Lean default:
```text
INIT → PLANNING → PLAN_PENDING_HUMAN
→ IMPLEMENTING → LOCAL_VERIFYING → TEST_RELEASE → TEST_VERIFYING
                                  ↘ TEST_DEPLOYED_NEEDS_MANUAL_VERIFY ↗
→ CONSOLIDATED_REVIEW → RELEASE_PENDING_HUMAN
→ BASE_MERGING → COMPLETE
```
Lean maintains only two manually maintained documents, requirements.md and plan.md; after a Review block, at most one delta closure is allowed. Environment items that cannot be started locally are documented with `deferred_to_test` as evidence, and delivery continues. Browser, login/MFA, and acceptance URL checks are performed only after deployment; if any are missing, delivery enters the recoverable `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY` state and does not roll back the test merge/CI.

Legacy full:
```
INIT → REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED → SPEC_REVIEWING
     → SPEC_PENDING_HUMAN (G1) → SPEC_APPROVED

for N in 1..total_sprints:
  KICKOFF → DEV + QA_CASES → SA_TEST_REVIEW → DOC_SYNC → SA_CODE → DEV_DONE

ALL_SPRINTS_DEV_DONE → INTEGRATION_REVIEW → TEST_RELEASE
                     → FINAL_QA → FINAL_EVAL → COMPLETE

FINAL_QA_BLOCKED → FINAL_FIX → FINAL_FIX_REVIEW → TEST_RELEASE → FINAL_QA
```
A Sprint is a development slice, not a deployment/acceptance slice. New requirements default to `final_only + auto_if_ready`; legacy progress without delivery stays on `per_sprint + manual`. An explicit exit, release driver, or test branch misconfiguration can block delivery before push; browser/login/MFA/verification URL issues only affect post-deployment acceptance and fall into recoverable manual verification. Production releases are always manual.

Circuit-breaker arrows (not in the main diagram):
- review_revision >= 3 → SPEC_REVIEWING (forces a Planner re-review)
- fix_per_bug >= 3 → TECH_LEAD_REVIEW (implementation path re-evaluation)
- evaluator_reject >= 2 → integration/spec approach re-evaluation

## Data Flow

Inputs entering cc-nexs:
- `requirements.md` filled in by a human
- Project `cc-nexs.config.yml` configured once by a human

Flow artifacts (by role):
- Planner → spec.md
- Reviewer → review.md / sa-review.md / sa-code-review.md / sa-test-review.md
- Developer → src/* + dev-plan.md + api-doc.md + deploy.md
- QA → test-cases.md + test-report.md + bugs/ + qa-scripts/
- Evaluator → acceptance.md
- Orchestrator/core controls → progress.json v2 + progress.md mirror

Invariants:
- spec.md can only be changed by the Planner
- progress can only be changed by the orchestrator + deterministic approve/release controls
- Review/test/acceptance md files are append-only and cannot be overwritten

## Comparison with the Previous Version (v0.1 monolith)

| Dimension | v0.1 (preset-standard monolith) | v0.2 monorepo |
|------|------|------|
| Engineering structure | Single plugin | core + multiple presets |
| Configuration | Hardcoded project rules | Declared in preset.yml, read by core |
| Hook | bash | Node.js cross-platform |
| Roles | Five roles hardcoded | preset declares which ones are enabled |
| Tools | codex hardcoded | reviewer-adapter abstracts multiple tools |
| i18n | Chinese hardcoded | Two-layer override: core + preset |
| Adding a new stack | Modify source code | Write a new preset, core untouched |

All v0.1 SOP behavior is fully preserved in v0.2 through `preset-standard`. Zero change from the user's perspective.
