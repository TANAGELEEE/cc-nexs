# Changelog

All notable changes to cc-nexs will be documented here.

## [Unreleased]

## [0.7.3] - 2026-10-29

### Fixed

- `/cc-nexs:compound <id>` run outside a dispatch (without `CC_NEXS_REQ_DIR`) now finds the requirement under the workspace's configured docs repository instead of a hard-coded `all-docs/`, so a docs repository at another path such as `alldocs/` works. Projects without a workspace config still fall back to `all-docs/`.

## [0.7.2] - 2026-10-29

### Fixed

- Test delivery no longer stalls when CI deploys a later tip of the shared test branch or reports a short SHA. A deployed `environment_revision` is accepted when its full commit contains the recorded integration commit; the controller records the actual deployed commit with an `exact` or `contains` proof, and Gateway B and test-environment exceptions honor that proof. This applies to Lean and Hotfix alike.

## [0.7.1] - 2026-10-29

### Fixed

- A model selection's `thinking` or `reasoning_effort` in a higher config layer (overlay, project, feature, role) now replaces a lower layer's `effort` instead of being silently shadowed by it.
- Test release and base release refuse a candidate that contains history from a test branch's first-parent chain (`TEST_HISTORY`). A feature branch that merged, rebased onto or pulled test would otherwise carry other unreleased features into the base branch.

### Changed

- Pi role dispatch accepts an explicit `max` thinking level.
- The Git guard now blocks every session, the orchestrator included, from merging, rebasing or pulling a configured or switched test branch inside a cc-nexs workspace. Claude Code and Codex enforce it through the hook, Pi through its extension.

## [0.7.0] - 2026-10-25

### Removed

- **Fast and Full modes**: `mode=fast`, `mode=full`, and legacy `lite` are removed together with their state machines, run rules, roles (Repo Scout, Planner, Tech Lead, SA, QA, Evaluator, Fullstack, Reviewer, Verifier), commands, templates, G1/G2 gates, Sprint state, implementation ownership/delta controllers, feature README sync, and the legacy progress.md migration. Unsupported modes now fail closed. Requirements use Lean; repairs use Hotfix.
- **preset-minimal**: The three-role preset and its install scripts are removed; `preset-standard` is the only published preset.

### Added

- **Independent Lean plan review**: A new `lean-plan-reviewer` role checks `requirements.md` and `plan.md` against the code before Gateway A and blocks only P0/P1. A blocked first round returns to the Planner once; later results go to Gateway A with open findings. `record-plan-review` binds the result to the plan hash and persists the next state, and Gateway A refuses a plan without a review of that exact hash.
- **Requirement traceability at Gateway A**: Every `AC-xxx` row in `requirements.md` must appear in a task row, a local check row, and a test check row of the approved plan scope, and the plan may not cite criteria absent from the requirements.

## Earlier notes (0.4.0 – 0.6.0)

### Added

- **Three-runtime risk-driven automatic model escalation**: Added `risk_tier`, `models.routing`, a provider-neutral `escalated` profile, and a unified resolver. Lean high/critical automatically escalates the Planner/Reviewer, Hotfix P0/P1 automatically escalates the Reviewer; an explicit feature profile takes final precedence, and decisions output the risk source/signals/matched rules. New templates no longer hard-code `models.roles`, and `/cc-nexs:migrate-feature-config` safely migrates historical features; Gateway A also binds the concrete risk.
- **Hardened escalation review**: Historical Gateway A derives risk only from hash-matched approved scopes, and unknown risk is conservatively escalated as high; `migrate-feature-config --bind-plan-risk` provides auditable backfill. The docs now cover native-agent model availability and the low-budget mapping requirements for all roles in Fast/Full.
- **Lean default token-saving flow**: Two human gates, one consolidated Review, worktree/feature branch isolation, local verification bound to the exact candidate, and test/base release; Gateway B feedback is triaged by evidence / implementation / scope and synced back to the single requirements/plan document. Builds now select by changed module, run in parallel with dependency awareness, and cache by exact candidate; Claude Code, Codex, and Pi all support per-role configuration of model and effort/thinking.
- **Hotfix mini-Lean**: Hotfix is now an independent `mode=hotfix` requirement that creates its own feature/worktree from the latest base and maintains only one `hotfix.md`; P0/P1/P2 get one consolidated Review, P3 is skipped after the machine boundary, and the entire fix lifecycle allows at most one delta. The exact candidate first goes through test black-box acceptance, and only after Gateway B approval does the same candidate enter base. Claude Code, Codex, and Pi use dedicated configurable roles.
- **Per-feature README auto-sync**: After every orchestrator state advance, `syncFeatureReadme(...)` is called automatically to refresh the AUTOGEN sections of `doc/<id>/README.md` (current status / artifact index / contract coverage snapshot / pending manual integration), delivering on the README template's promise that "the first thing to do when entering the directory is to read this file."
  - New file: `packages/core/lib/readme-sync.mjs` + unit tests
  - templates/README.md restructured: added `<!-- AUTOGEN:status START/END -->` anchors; the "Next actions" subsection moved outside the anchors for manual maintenance
  - Trigger points: after transitionState in `/cc-nexs:run`, before the human gate, and before COMPLETE; the initial README is seeded after `/cc-nexs:init` completes
  - **Backward compatible**: Old READMEs without AUTOGEN anchors → readme-sync skips automatically + warns, without forcing changes
  - **Fail-safe**: sync errors only console.warn and do not block the main flow
  - **Idempotent**: returns `no_change` when a rerun produces no changes and writes no file (avoiding git noise)
  - tech-lead-claude.md anti-patterns now include "do not manually edit AUTOGEN sections"
- **`docs/solutions/` compounding capture mechanism**: Added a `compound` side-channel role + `/cc-nexs:compound <id>` command; after a requirement wraps up, "non-obvious lessons" are deposited into the repo-level `docs/solutions/<topic>.md`. In the RECON phase of the next similar requirement, Repo Scout automatically greps for `frontmatter.keywords` hits and extracts them into repo-context.md `## 7.6 既往教训命中`, so the Planner avoids the pitfall on the very first draft — this is the literal definition of cc-nexs compounding.
  - New files: `agents/compound-claude.md`, `commands/compound.md`, `templates/solution.md`
  - **Strong-signal filter**: A solution is produced only when at least one of the following holds: "the same BUG fixed ≥ 2 times / SA feedback repeated across sprints / RECON overturned / acceptance rejected / spec change ≥ 3 lines"; if none applies, **forcing a write is forbidden**, and "skipped" is written to compound-summary.md
  - **Dedupe by frontmatter.slug**: Multiple requirement triggers on the same topic → Edit the existing file to append observations rather than creating a new one
  - Side-channel command that **does not enter the state machine** — supports going back over historical requirements (`--force` skips the COMPLETE check), keeping the state machine simple
  - run.md COMPLETE output adds a one-line "💡 suggest running /cc-nexs:compound" hint, but does not enforce it
- **AGENTS.md / CLAUDE.md grounding**: Repo Scout's workflow gains step 1.5, which scans the project root's AGENTS.md (preferred) / CLAUDE.md (fallback) and extracts project-level mandatory conventions (naming/injection/banned APIs, etc.) into repo-context.md `## 7.5 项目级强制约定`. This keeps the Planner from colliding with project-level mandatory rules when designing the spec.
- **RECON phase (current-state survey)**: Before the Planner drafts the spec, a new `repo-scout` role runs in an independent session to scan src/ and produce `repo-context.md` (a factual inventory of comparable configuration/Service/Mapper/pages/API/DTO). The Planner still keeps the iron rule of "do not read src/", but obtains current-state information indirectly through repo-context.md, avoiding a spec designed in a vacuum that is disconnected from the existing codebase.
  - New files: `agents/repo-scout-claude.md`, `templates/repo-context.md`, `commands/recon.md`
  - State machine (full mode): `REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED`; `SPEC_NEEDS_REVISION` does not rerun recon
  - fast mode: recon is folded into a pre-step before `/cc-nexs:fullstack --phase=spec`, and the state machine does not expose RECON_DONE
  - The spec.md template's "Impact scope" section now mandatorily adds a "current-state comparison" subsection (reuse / extend / new + rationale + conflict points)
  - **Backward compatible**: When the preset does not enable the `repo-scout` role, `REQ_DRAFTED` jumps directly to `SPEC_DRAFTED` (old behavior)
- `using-worktrees` skill (`packages/preset-standard/skills/using-worktrees/SKILL.md`): detects whether it is already in a worktree → `git worktree add .worktrees/<id>-<slug>` → automatically adds a `.gitignore` entry to the host repo → creates the `feature/<id>-<slug>` branch. Three special adaptations were made for cc-nexs: a fixed `.worktrees/` path (instead of `.claude/worktrees/` used by Claude Code's built-in EnterWorktree), nested init refusal, and auto-committing the gitignore.
- `/cc-nexs:build` command + `lib/build-selector.mjs`: automatically selects build/test commands based on the git diff. `cc-nexs.config.yml` gains a `paths_override.modules[]` field, where each module contains `name`, `match` (glob array), `build_cmd`, and `test_cmd`. The selector uses `git diff <diff_base>...HEAD` + `git status --porcelain` to obtain changed files and matches them against each module's globs; matched modules run their commands serially in yml order, and if nothing matches it falls back to the top-level `paths_override.build_cmd` / `test_cmd`.
  - Cross-module changes run all matched modules in sequence; any failure fails fast.
  - Leaving the top-level `build_cmd` empty = do not run a build when there are only docs/no source changes.
  - `paths_override.diff_base` defaults to `main`; if your main branch is named something else (`master`, `develop`), override it.
  - Usage: `/cc-nexs:build [--phase=build|test|both] [--dry-run]`.

### Fixed

- Windows-native Codex/Claude hook startup no longer depends on `${VAR:-fallback}`: the plugin root is resolved by Node from `PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT`, supporting spaces and Chinese paths; the local installer adds an isolated Home, atomic config writes, preset mutual exclusion, and Windows CI/smoke coverage.
- Hotfix test blocks now persist a counter and trip the breaker at the `fix_per_bug` threshold; once the single delta has been consumed, the fix loop is not re-entered; rewriting the same test attempt is not counted twice.
- P3 boundary violations are now structured as `HOTFIX_P3_BOUNDARY_BLOCKED -> HUMAN_INTERVENTION`, and on pass the machine proof is bound to the exact candidate, preventing an abnormal Orchestrator exit or evidence loss.
- Lean local re-verification records the `review` / `test` / `gateway_b` source and returns to the precise fix state after a failure; controller-level coverage is completed for the three categories of Hotfix Gateway B feedback.
- The Lean Gateway A plan adds complexity and mode-fit fields; the Planner explicitly recommends Full for high-coupling, contract-breaking, and high-risk changes, with humans deciding whether to start a separate flow.
- `lib/config-loader.mjs::parseYaml` rewritten as a recursive descent parser. The previous stack-machine version crashed on nested array-of-object structures (e.g. `forbidden_patterns:` + `excludes:` arrays, `modules:` + `match:` arrays), but because the loader had not previously been called on the orchestrator's critical path, the bug remained hidden. The fix correctly parses every structure in `preset-standard/preset.yml`, with new capabilities: inline flow arrays (`["a","b"]`) and `#` inside strings no longer being truncated as a comment.

### Changed

- **BREAKING (default behavior)**: `/cc-nexs:init` now creates an independent git worktree at `<repo>/.worktrees/<id>-<slug>/` by default, so multiple requirements can be developed in parallel; it no longer runs `git checkout -b` directly in the current directory.
  - `--no-worktree` falls back to the old behavior
  - Running init again inside a worktree is forbidden (one worktree per requirement)
- `/cc-nexs:run` adds Step -1: checks whether cwd is inside the expected `.worktrees/<id>-*`; if not → refuses and prompts the user to `cd`. Requirements created with `--no-worktree` are unaffected.
- `/cc-nexs:run` prints the manual worktree cleanup command (`git worktree remove`) on `COMPLETE` and does not clean up automatically.

### Migration Guide

Users who want to keep the old `git checkout -b` flow: add `--no-worktree` to every `init` command. Alternatively, configure a default in `cc-nexs.config.yml` (not yet implemented; may be added later).

## [0.3.0-dev] - 2026-05-22
Added **fast mode**: a single-sprint, three-role merged pipeline that uses ~50% fewer subagent calls than full mode, suited to small changes to a single endpoint or module.

### Added

- 3 merged roles:
  - `fullstack-claude` (merges Planner + Tech Lead): handles spec drafting + coding + doc sync + bug fixing in one pass
  - `reviewer-codex` (merges SA code review + Evaluator contract acceptance): a single codex call produces both sa-code-review.md + acceptance.md
  - `verifier-codex` (merges QA cases + run + regression): the first call produces both test-cases.md + test-report.md
- 3 slash commands: `/cc-nexs:fullstack` / `/cc-nexs:review` / `/cc-nexs:verify`
- preset.yml adds a top-level `modes:` field declaring enabled + state_machine + thresholds_override for both full and fast modes
- core/lib/state-machine.mjs adds a `mode='fast'` branch: the state sequence is `BUILD → TEST → [FIX → REGRESSION]* → ACCEPT → COMPLETE`, with no SPRINT_<N>_* naming (single sprint enforced)
- core/schemas/preset.schema.json adds `modes` validation
- templates/config.json adds a fast option and selection guidance to `_mode_options` (`_mode_选择建议`)
- templates/progress.md splits the state-machine dictionary into two sets of tables, full and fast

### Changed

- preset.yml version `0.2.0-dev → 0.3.0-dev`, with the description now noting "supports both full and fast modes"
- run.md adds Step 0.5 (resolve mode) + a role → command dispatch table (columns per mode) + a fast-mode merged parsing section (parse both md files at once after state=ACCEPT)
- fast mode has stricter circuit-breaker thresholds: `review_revision: 2` / `fix_per_bug: 2` (full mode is still 3 / 3); after 2 fixes on the same BUG it stops for a human, with no TECH_LEAD_REVIEW fallback role

### Choosing a Mode

| Use full when | Use fast when |
|---|---|
| Cross-module, includes DB schema changes | Single module, single endpoint |
| Involves external contracts or compliance risk | Change ≤ 800 lines of diff |
| Sprint slices ≥ 2 | No concurrency or transaction complexity |

## [0.1.0] - 2026-05-17

Initial release. Splits the v2.1 five-party heterogeneous SOP into a Claude Code Plugin form.

### Added

- 9 slash commands: run / planner / sa / dev / qa / evaluator / hotfix / approve-spec / status
- 5 role agents: planner-claude / tech-lead-claude / sa-codex / qa-codex / evaluator-codex
- 4 passively triggered skills: using-cc-nexs / role-isolation / md-aggregation / commit-discipline
- 3 PreToolUse hooks: role-boundary-guard / spec-gate-guard / pre-merge-check
- Complete template set: requirements / spec / dev-plan / test-cases / api-doc / deploy / acceptance / test-report / progress (state-machine skeleton) / config / bugs/BUG-template
- State-machine orchestration: a self-loop driven by progress.md
- The only human gate: stop once after the spec passes SA review
- Three-level circuit breakers: SA review / dev loop / Evaluator failure
- Three-tier hotfix classification: P3 / P2 / P0-P1
