# cc-nexs

[English](./README.en-US.md) · [繁體中文（台灣）](./README.zh-TW.md)

> A multi-role, state-machine-driven development workflow framework for Claude Code / Codex / Pi. The source is maintained as a monorepo, and release artifacts are distributed through each runtime's native extension mechanism.

## What This Is

The development workflow SOP is split into two layers:

- **`packages/core/`** — the shared framework. State machine engine, role registration, reviewer tool adaptation, cross-platform hooks, i18n, shared commands.
- **`packages/preset-*/`** — project presets. They declare which roles are enabled, which tools are used, which stack checks run, and which templates are loaded.

Source stays easy to maintain (monorepo) while distribution artifacts stay flat (each preset is materialized into `dist/`, self-contained and installable); `pnpm build` materializes the core contents into each preset's dist directory. Claude Code and Codex use the dist plugin; Pi uses the root package manifest, extensions, skills, and package agents, but all three share the same command SOP.

## Current Presets

| Preset | Use case | Roles | Tools | Language |
|--------|---------|------|------|------|
| `preset-standard` | General multi-repo projects; the concrete tech stack is injected by a private overlay | **lean** requirements and **hotfix** repairs; Pi uses pi-subagents to isolate roles | Each Lean/Hotfix role can configure its model and effort/thinking; the public preset does not pin model IDs | English |

To add a preset, follow [docs/extending-presets.md](./docs/extending-presets.md). For modes and role selection, see [docs/role-map.md](./packages/preset-standard/docs/role-map.md) in `preset-standard`.

New requirements in `preset-standard` use Lean. The Planner's plan is first challenged by an independent Plan Reviewer against the requirements and the code; a blocked plan gets one revision, and Gateway A refuses a plan whose acceptance criteria do not each trace to a task, a local check, and a test check. Small requirements that are low/medium risk, reuse existing capabilities, and add no new table schemas/infrastructure/breaking contracts take the fast-track by default: once the plan is approved, implementation runs in parallel across worktree/feature branches, and any build/start/smoke that can be completed locally is completed immediately; for example, when backend-java cannot be started locally, it records structured `deferred_to_test` evidence and moves on instead of retrying repeatedly. The exact candidate is then frozen, merged into test first with CI/deployment triggered, accepted in the deployed environment (web can start locally and connect to the deployed test backend), and finally given one consolidated Review, stopping at Gateway B. Browser, login/MFA, and acceptance page URLs all belong only to post-deployment verification; when a capability is missing, the flow enters a recoverable `manual_required` and does not block or roll back the test merge/CI. High-risk Lean uses the Review-first standard lane with an escalated Plan Reviewer and Reviewer; a requirement too large to review and verify as one plan is split into separately approved Lean requirements.

Lean/Hotfix models use risk-driven routing. The effective precedence is: public preset < private overlay < project `cc-nexs.config.yml.models` < feature profiles/routing < matched routing rules < explicit overrides in feature `models.roles`. New feature templates no longer generate `models.roles`, so everyday project configuration actually takes effect.

Under `risk_tier:auto`, Lean takes its value from the plan risk bound at Gateway A, and Hotfix infers it from the bound P0/P1/P2/P3 severity. When a historical Gateway A lacks the risk field, the value is derived only from an approved scope whose hash matches exactly; if that cannot be proven, the tier is conservatively raised to `high` and never silently falls back to `medium`. The public rules automatically switch the Planner/Reviewer for Lean `high|critical` and the Reviewer for Hotfix P0/P1 to `escalated`. The public `escalated` profile remains provider-neutral `inherit + xhigh`; to switch to an actual high-capability model, a project should override the same-named profile in its private configuration:
```yaml
models:
  profiles:
    daily-development:
      claude:
        model: inherit
        effort: medium
      codex:
        model: inherit
        effort: medium
      pi:
        model: inherit
        effort: medium
    daily-review:
      claude:
        model: inherit
        effort: high
      codex:
        model: inherit
        effort: high
      pi:
        model: inherit
        effort: high
        fallback_models: []
    escalated:
      claude:
        model: your-strong-claude-model
        effort: xhigh
      codex:
        model: your-strong-codex-model
        effort: xhigh
      pi:
        model: your-provider/strong-model
        thinking: xhigh
  roles:
    lean-developer: daily-development
    lean-reviewer: daily-review
```
Projects can continue to configure a low-budget everyday profile for Planner, Developer, Reviewer, and Verifier separately; only roles that match a risk rule are upgraded. An explicit feature profile remains the final human decision, and `models.routing.enabled: false` explicitly disables automatic routing. All three hosts always use an independent Reviewer session.

Before configuring a specific model, you must defer to the host's native subagent override capability; a model appearing in the top-level catalog does not mean the current native-agent dispatch will necessarily allow it.

Note: `models.routing.rules` is an ordered array, and later matching rules override earlier matching rules; once an overlay/project/feature declares this array, it replaces the lower-level array as a whole rather than appending by `id`. When only overriding profiles/roles, do not redeclare rules.

The default `models.roles` already generated by legacy Lean/Hotfix features will shadow the project configuration; preview safely before migrating:
```text
/cc-nexs:migrate-feature-config <id> --dry-run
/cc-nexs:migrate-feature-config <id>
/cc-nexs:migrate-feature-config <id> --dry-run --bind-plan-risk
/cc-nexs:migrate-feature-config <id> --bind-plan-risk
```
Migration only removes complete default mappings that structurally and exactly match the old template; any custom role/profile/routing is preserved. `--bind-plan-risk` is a separate opt-in: it only backfills hash-verified concrete risks into the legacy Gateway A and records a migration event; stale/missing/ambiguous scopes are rejected for writing.

All four Lean roles in Claude Code use independent Claude subagents; all four Lean roles in Codex use independent native agents; Pi uses the `subagent` from `pi-subagents@0.35.1`, encoding thinking as the task's `provider/model:thinking` selector, with no need to maintain a separate role mapping in `.pi/settings.json`. Pi's `fallback_models` only retries failed tasks and does not re-run parallel siblings that already succeeded.

## Directory Structure
```
cc-nexs/
├── packages/                       source (monorepo)
│   ├── core/                       shared framework
│   │   ├── commands/               shared orchestrator commands (run/approve-plan/status/release)
│   │   ├── lib/                    Node.js framework code
│   │   ├── hooks/                  cross-platform .mjs hooks
│   │   ├── schemas/                preset / workspace / overlay / progress.json v2 Schema
│   │   └── i18n/{zh-CN,en-US}.json
│   │
│   ├── preset-standard/            Lean + Hotfix preset (English)
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── preset.yml
│   │   ├── agents/                 Lean, Hotfix, and Compound role definitions
│   │   ├── commands/               preset-owned phase commands (init/plan/execute/lean-review/lean-verify/hotfix)
│   │   ├── skills/ × 4
│   │   ├── docs/                   preset architecture / workflow / role-map
│   │   ├── templates/              localized Lean, Hotfix, and solution templates
│   │   └── hooks/hooks.json        hook registration (implementation scripts come from core)
│
├── scripts/
│   └── build.mjs                   build script: materialize core into each preset
│
├── .claude-plugin/                 Claude Code marketplace
│   └── marketplace.json
│
├── .agents/plugins/                Codex marketplace
│   └── marketplace.json
│
├── dist/                           build artifacts (**committed to git** so GitHub / Codex marketplace can install the plugin directly)
│   ├── preset-standard/            flat self-contained plugin
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── commands/               preset + core commands materialized together
│   │   ├── agents/
│   │   ├── skills/                 Claude Code native skills (kept out of the Codex mirror to avoid polluting Claude)
│   │   ├── codex-skills/           Codex command mirror skills
│   │   ├── docs/
│   │   ├── templates/
│   │   ├── hooks/                  *.mjs（from core）+ hooks.json（from preset）
│   │   ├── lib/                    materialized core/lib
│   │   ├── schemas/                materialized core/schemas
│   │   └── i18n/                   merged core + preset
│
├── examples/
│   └── using-preset-standard/      example project
│
├── docs/
│   ├── architecture.md             core × preset relationship
│   ├── codex-plugin.md             Codex plugin installation and replication guide
│   ├── pi-plugin.md                Pi P2 installation, model isolation, and support boundaries
│   └── extending-presets.md        new preset guide
├── pi/
│   ├── extensions/cc-nexs.ts       Pi slash command + child role guard
│   ├── skills/                      lean + hotfix P2 command mirrors
│   └── agents/                      pi-subagents package roles
│
├── pnpm-workspace.yaml
└── package.json
```
## Build
```bash
pnpm build             # build all presets
pnpm build:codex       # same as build; explicitly refresh Codex plugin artifacts
pnpm build:standard    # build preset-standard only
pnpm validate:claude   # validate Claude Code marketplace / install script entry points / skill isolation
pnpm validate:codex    # validate Codex manifest / marketplace / command mirror skills
pnpm validate:pi       # validate Pi package / P2 skills / package agents / no fixed models
pnpm validate:sop      # validate key document anchors and mirror contracts for lean / plan review / hotfix
pnpm smoke:claude-install # smoke-test local Claude Code installation with a temporary HOME; do not touch the real ~/.claude
pnpm smoke:pi-install  # verify local Pi package registration with a temporary PI_CODING_AGENT_DIR
pnpm validate:plugins  # validate Claude Code + Codex plugin artifacts and installation shapes
pnpm clean             # delete dist
```
What build does:

1. Copies the preset's own `commands / agents / skills / docs / templates / preset.yml / i18n` into `dist/<preset>/`
2. Materializes `core/commands` and `core/hooks` into `dist/<preset>/`; **same-named preset files take precedence** (they are not overwritten)
3. Copies `core/lib`, `core/schemas`, and `core/i18n` into `dist/<preset>/`
4. Rewrites paths in text files: `core/lib/X` → `lib/X`, `_core/X` → `X`, `../core/X` → `X`
5. Automatically generates `.claude-plugin/marketplace.json`, listing every preset as a Claude Code plugin
6. Automatically generates `.agents/plugins/marketplace.json`, listing every preset as a Codex plugin
7. Generates `codex-skills/` for Codex: each `commands/*.md` produces a `$cc-nexs-*` mirror skill that still points back to the original command document; the original `skills/` are not written into the Codex mirror, so the Claude Code plugin is not affected
8. Generates lean + hotfix command skills and package-qualified role agents for Pi

`dist` is the actual plugin carrier. Claude Code reads `.claude-plugin/marketplace.json`; Codex reads `.agents/plugins/marketplace.json`. Both point to the same set of `dist/preset-*`. Entry points on all three platforms are explicit-trigger only: ordinary natural-language development requests will not automatically enable cc-nexs.

## Installation

### Local installation for Codex
```bash
cd /path/to/cc-nexs
pnpm install:local:codex
```
This runs:

1. `pnpm build`
2. `pnpm validate:plugins`
3. Sync `dist/preset-*` to `~/.codex/plugins/cache/cc-nexs/`
4. `codex plugin marketplace add /path/to/cc-nexs`
5. Enable `cc-nexs@cc-nexs` in `~/.codex/config.toml`

Then restart Codex or open a new thread. You can check whether `cc-nexs@cc-nexs` is enabled in `/plugins`; before hooks run for the first time, you need to review + trust them in `/hooks`.

Codex uses an explicit skill entry point; each mirror skill's `agents/openai.yaml` sets `policy.allow_implicit_invocation: false`, so it does not enter the default model context. `/cc-nexs:*` serves only as a compatibility text hint, not an executable shell/slash command:
```text
$cc-nexs-init "requirement description"             # defaults to lean
$cc-nexs-plan 01
$cc-nexs-approve-plan 01
$cc-nexs-run 01
$cc-nexs-approve-release 01
$cc-nexs-release-base 01
$cc-nexs-release-test 01
$cc-nexs-hotfix "symptom description" --repos=api  # automatically creates a Hotfix branch and BUG document without consuming a requirement number
```
The Codex-side implementation approach is command mirror skills. `$cc-nexs-run` reads `commands/run.md` as the single source of truth, so the document write locations and state machine logic for lean / hotfix do not diverge. The approval skill calls the deterministic `cc-nexs` controller and does not modify progress manually. See [docs/codex-plugin.md](./docs/codex-plugin.md) for details.

### Claude Code local development (one command)
```bash
cd /path/to/cc-nexs
pnpm install:local              # equivalent to: build + copy to ~/.claude/plugins/cache/
```
`install:local` does the following:

1. Run `build` to produce `dist/preset-<name>/`
2. **Actually copy** it to `~/.claude/plugins/cache/cc-nexs/cc-nexs/<version>/` (no symlink — Claude Code cleans up non-standard cache during startup)
3. Sync `~/.claude/plugins/installed_plugins.json` metadata
4. Verify that the plugin is enabled in `~/.claude/settings.json`

Restart Claude Code after this and it takes effect. After changing source later, just run `pnpm install:local` once more. Claude Code's commands and native skills both set `disable-model-invocation: true`; they run only when the user types `/cc-nexs:*` or an explicit skill command. The routing description for role agents is likewise limited to accepting dispatch only from an explicitly started cc-nexs parent flow.

### Pi P2 Installation

Pi currently has experimental P2 support, with a commitment to the `preset-standard` lean and hotfix flows. Public GitHub installation:
```bash
pi install npm:pi-subagents@0.35.1
# macOS preferred provider (open ego lite after installation for first-run setup)
npx skills add citrolabs/ego-lite
# fallback when Windows or ego lite is unavailable
pi install git:github.com/injaneity/pi-computer-use@v0.4.3
pi install git:github.com/<github-owner>/cc-nexs
```
The computer-use fallback must be enabled in the project's `.pi/computer-use.json` (or the global configuration) with `{"browser_use":true,"headless":true}`. Here, headless means no taking over foreground focus, physical keyboard/mouse, or cursor; Windows still requires an interactive desktop session and an already-open browser window.

When developing or debugging from this repository, use the local installation:
```bash
pnpm install
pnpm install:local:pi
```
Pi does not invoke the Codex CLI. The generated Pi skills set `disable-model-invocation: true`, are hidden from the system prompt, and can only be invoked explicitly via `/cc-nexs:*` or `/skill:cc-nexs-*`. Lean roles resolve `model`, `thinking`, and `fallback_models` from the cc-nexs profile; the parent agent encodes thinking in the `model` selector of the `subagent` task, and the Reviewer can use a different model, or the same model with higher thinking. When the primary model is unavailable, only failed tasks are retried in fallback order. `.pi/settings.json` retains only Pi authentication and the `enabledModels` scope. Pi selects a browser provider only after test merge/CI completes: it prefers ego lite, and when that is unavailable, selects the independent computer-use Verifier, requiring the effective configuration to be `browser_use: true` and `headless: true`. The same child never receives both providers; when neither is available or the login session is invalid, the deployed candidate remains unchanged and verification enters a recoverable `manual_required`. See [Pi P2 support](./docs/pi-plugin.md) for details.

Claude Code automated environment acceptance uses `chrome-devtools-mcp`; Codex reuses the currently logged-in in-app/Chrome session. All three runtimes access `release.test.allowed_hosts` only after deployment; a missing browser, login/MFA, or acceptance URL only produces `manual_required` and does not block test merge/CI. Plaintext account credentials must not be read from project memory, Markdown, or Git; necessary logins may only go through an opaque `credential_ref` to an external secret provider.

### Install Claude Code from GitHub (other machines / collaborators)
```bash
/plugin marketplace add <github-owner>/cc-nexs
/plugin install cc-nexs@cc-nexs                 # preset-standard
```
`/plugin marketplace add <github-owner>/cc-nexs` fetches the `.claude-plugin/marketplace.json` at the repository root; its `plugins[].source` points to `./dist/preset-*`—so the publishing repository must include a `dist/` that has passed reproducible-build verification.

## Daily Commands

Claude Code, Codex, and Pi share the same command semantics but use each runtime's native entry points. All three treat `commands/*.md` as the source of truth for the workflow, and approval status is written consistently by the core `cc-nexs` commands; when the entry points in the table below are absent, none of the three may automatically enter cc-nexs based on natural language alone.

“Explicit triggering only” applies only to the entry point and does not change automatic progression within the workflow: after `run` is explicitly invoked, the Orchestrator continues until it reaches an existing human gate, hits an explicit blocker, or lacks the capability to proceed, without requiring the user to call internal stage commands such as `execute`, `lean-review`, and `verify-local` step by step.

| Runtime | Recommended entry points |
| --- | --- |
| Claude Code | `/cc-nexs:plan 01`, `/cc-nexs:run 01`, `/cc-nexs:approve-release 01` |
| Codex Desktop / CLI | `$cc-nexs-plan 01`, `$cc-nexs-run 01`, `$cc-nexs-approve-release 01` |
| Pi | `/cc-nexs:plan 01`, `/cc-nexs:run 01`, `/cc-nexs:approve-release 01` |
| Plain terminal | `cc-nexs approve-plan 01`, `cc-nexs verify-local 01`, `cc-nexs approve-release 01` |
```bash
/cc-nexs:init "requirement description"          # defaults to lean; each repo uses an independent worktree + feature/<id>-<slug>
/cc-nexs:plan [id]               # generate requirements/plan, run one independent plan review, render temporary HTML, then stop at Gateway A
/cc-nexs:approve-plan [id]       # approve the plan hash
/cc-nexs:run [id]                # implement → local verification where possible → test/CI → environment acceptance → one consolidated Review
/cc-nexs:approve-release [id]    # Gateway B，approve the exact tested fingerprint
/cc-nexs:request-release-changes [id] --type=... --feedback="..."  # submit Gateway B feedback and return safely
/cc-nexs:release-base [id]       # merge into the configured base after approval; archive docs last
/cc-nexs:run [id] --no-auto-test-release # explicitly hand this run to an external test release; a manual release is not a release attempt
/cc-nexs:release-test [id]      # deterministically merge the complete candidate into test and call the release driver
/cc-nexs:status [id]            # read-only status view
/cc-nexs:build [--phase=...]      # select and run build/test commands from git diff

/cc-nexs:hotfix "symptom description" --repos=api  # hotfix/<key> + BUG document without consuming a requirement number
/cc-nexs:hotfix [bug-key]         # resume: local verification, independent Review, test, Gateway B
/cc-nexs:revise-hotfix [bug-key] --reason "reason" --authorization-evidence "existing authorization" # rebind the original task
```
Gateway A/B are state-machine pause points, not global tool locks. While waiting for human confirmation, the parent session can still perform Git, SQL, SSH, deployment, diagnostics, and documentation operations authorized by the user; only the next cc-nexs role will not be dispatched.

### Multi-module projects automatically select the build command by directory (since v0.3)

Mixed-stack repositories (such as a Java backend plus a Next.js frontend) often contain multiple build commands in a single repository. `/cc-nexs:build` reads `paths_override.modules` from `cc-nexs.config.yml` and uses `git diff` to determine which modules the current requirement changed, **running only the commands of the modules that match**:
```yaml
paths_override:
  diff_base: main
  build_cmd: ""      # top-level fallback (run for doc-only changes)
  test_cmd:  ""

  modules:
    - name: backend
      match: ["api-service/**"]
      build_cmd: "cd api-service && mvn -q compile"
      test_cmd:  "cd api-service && mvn -q test"
    - name: web
      match: ["web/**"]
      build_cmd: "cd web && pnpm build"
      test_cmd:  "cd web && pnpm test"
```
Running from any requirement worktree discovers the workspace root configuration upward, or you can pass `--config-root` explicitly. Cross-module changes (backend + web modified together) default to a maximum of 2 independent modules in parallel; declare ordering constraints with `depends_on`, and when a downstream module is hit, the dependency closure is filled in automatically. Successful results are bound to the full Git candidate fingerprint and cached outside the repository; any change to HEAD/base/diff/untracked/commands triggers re-execution. `workflow.local_verify.reuse_passed=true` also reuses local evidence for the same candidate; when Lean has no driver configured, you can bind directly to the command/exit/proof of a plan-approved command; Hotfix likewise supports binding command evidence within scope, must cover the frozen matrix, and is not allowed to defer to test. All Hotfix levels (including P3) require an independent Review.

### Multi-repo Worktree and Git Custodian (v0.4)

Configure `.cc-nexs/workspace.yml` in the workspace root. For ordinary Lean/Fast/Full, `/cc-nexs:init` first fast-forward pushes a minimal reservation commit containing only a README and a reservation marker to the docs repo's remote base, so developers who do not use cc-nexs can see the number immediately; concurrent conflicts trigger a re-fetch and a retry with a new number. After the number is successfully reserved, create `.worktrees/<id>-<slug>/<repo-id>/` from each repo's latest `origin/<base_branch>`; it will not use the `test`/`master` currently checked out in the main checkout, nor will it incorrectly bind the feature's upstream to the base branch.
```
/cc-nexs:init "requirement A"     → create .worktrees/01-feat-a/{docs,api,web}/
/cc-nexs:run 01            → continue from the workspace root or any assigned worktree

# start another requirement in parallel
cd <workspace-root>
/cc-nexs:init "requirement B"     → create another multi-repo worktree set
```
A hotfix directly creates `hotfix/<key>` and `.worktrees/<key>/<repo>/`. When a related requirement exists, the BUG is written to its `doc/<id>.<slug>/bugs/BUG-<key>.md`; when none exists, it is written to `hotfix/<key>/BUG-001.md` in the docs repo. Machine state lives in the workspace under `.cc-nexs/hotfixes/<key>/`; the BUG is located through `progress.hotfix_document`, and no placeholder commits are published. Legacy `hotfix.md` tasks remain recoverable. For an authorized revision of the same failure, use `revise-hotfix` to rebind on the original branch; contract extensions add `--promote-lean`, creating a Lean document beside the original BUG and passing Gateway A.

When a deployment has actually reached test but environment capabilities block acceptance, the user may explicitly authorize `approve-release --test-exception` at the existing Gateway B. The controller requires the same candidate's local verification and Review to pass, along with authorization, environment, and rollback evidence; it preserves the fact that test did not pass, authorizes only configuring base integration, and does not authorize production deployment by default.

Roles write only files within their remit and never perform Git mutations. The only direct docs-base write is the Custodian's phase-one number reservation for a normal requirement, and it may only create a requirement directory that did not previously exist. Ordinary commits do not run `git pull`. After the user explicitly authorizes merging to master, the Custodian fetches and merges the latest base into the feature; the code repo merges first, and the all-docs phase-two archive merges last; the same release task then fully deletes the remote feature, local feature, worktree, and candidate ref. The only exception is when the user explicitly asks to keep the remote branch.

The concrete phase commands (invoked one step at a time by a role) are determined by each preset; see each preset's README for details.

## Design Principles

1. **Event state machine** — `progress.json` v2 is the authoritative event log with revisions; `progress.md` is only a human-readable view
2. **Two gate types with distinct semantics** — Lean fixes Gateway A (reviewed, traceable plan) and Gateway B (tested candidate); if acceptance capability is insufficient after deployment, the task enters a recoverable `manual_required` without blocking test delivery
3. **Bounded loops** — one plan revision, one Review delta closure, and a per-bug repair breaker escalate to a human instead of looping
4. **Hard isolation of role boundaries** — hooks block out-of-scope operations via the `CC_NEXS_ROLE` environment variable
5. **Pluggable presets** — new project stacks get a new preset without touching core
6. **One source for multiple runtimes** — Claude Code, Codex, and Pi share the command SOP; runtimes only adapt role scheduling, model resolution, and permission interception
7. **Source / distribution separation** — source is kept clear in a monorepo, while distribution uses a flat plugin compatible with the Claude Code and Codex loading mechanisms

## Status

The current version runs Lean requirements and Hotfix repairs: after the Lean fast-track records locally unverifiable items as `deferred_to_test`, it prioritizes completing the deterministic test merge/CI; cross-platform browser verification happens only after deployment, where insufficient capability can be recovered manually without rolling back delivery that has already completed.

For workflows that require cross-vendor adversarial review (for example a Claude planner with a Codex reviewer), use the separate `nexs-sop` skill; cc-nexs keeps every role inside the active runtime and contrasts models through per-role profiles.

## License

MIT

## Localization

Runtime strings support `en-US`, `zh-CN`, and `zh-TW`. Set the project `language` to choose a locale; preset overrides live in `i18n/<locale>/strings.json`. Template overlays can be added under `templates/<locale>/` and selected with `CC_NEXS_LOCALE` (default `en-US`); missing files fall back to the default templates, preserving the workflow contract.
