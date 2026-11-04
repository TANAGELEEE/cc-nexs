# Changelog

All notable changes to cc-nexs will be documented here.

## [Unreleased]

## [0.15.1] - 2026-11-04

### Fixed

- `/cc-nexs:verify-skill` requires helper scripts to read the account only from `CC_NEXS_TEST_USER`/`CC_NEXS_TEST_PASSWORD` and to run through `cc-nexs test-account --`, forbids reading credential files themselves and putting a credential or derived hash on a command line, describes accounts by properties instead of identity, and checks all of this before handing over; `--refresh` applies it to existing scripts.

## [0.15.0] - 2026-11-04

### Added

- `browser-provider --runtime <claude|codex|pi>` freezes one Verifier browser per attempt: Claude Code and Pi prefer ego lite when its probe passes (Claude Code falls back to `chrome-devtools-mcp`, Pi to the headless computer-use Verifier), and Codex uses its in-app/Chrome session.
- `release.test.credential_ref` resolves `env:<USER_VAR>,<PASSWORD_VAR>`, `dotenv:<untracked file>#<USER_VAR>,<PASSWORD_VAR>`, and `keychain:<service>/<account>`. `test-account --check` reports readiness without values, and `test-account -- <command>` passes the account to that command only, as `CC_NEXS_TEST_USER` and `CC_NEXS_TEST_PASSWORD`.

### Changed

- The preset defaults `release.test.browser.claude_provider` to `ego-lite` with `claude_fallback: chrome-devtools-mcp`.
- Verifiers drive journeys themselves in the frozen browser, reuse its signed-in session before the configured account and ask the human last, screenshot each journey's end state and check layout, error/empty/loading states, and console errors, and report account preconditions (such as credits) as `manual_required`.
- `/cc-nexs:verify-skill` writes journeys as browser steps with account preconditions, ships scripts only for the Doctor and API probes, and `--refresh` converts journey scripts into steps.

### Fixed

- The ego lite probe accepts the ready marker on stderr, where the embedded runtime writes without a terminal, so Pi and Claude Code no longer fall back when ego lite works.

## [0.14.1] - 2026-11-04

### Added

- Verification guides can live outside the code repository. `/cc-nexs:verify-skill <repo> --docs` writes the guide and feature map to the workspace docs repository under `.cc-nexs/verify/<repo>/` (shared and versioned once committed to its base branch), and `--workspace` writes them to `<workspace>/.cc-nexs/verify/<repo>/` (local only). `verify-guides` uses the first guide it finds: the candidate commit, then the docs repository's committed base (`origin/<base>`, else `<base>`), then the workspace; it prints the source and an exact read command.

### Changed

- `/cc-nexs:verify-skill` never writes credential values (it names the variable or secret store instead and searches its output before handing over), keeps screenshots and other evidence outside every repository, and confirms that `git status` shows nothing from the run besides the guide.

## [0.14.0] - 2026-11-04

### Added

- Review is split into parallel Finders and a Judge. Finders search the exact candidate through one lens each (`correctness`; `contracts-data` from medium risk; `security` from high risk, with Hotfix severity mapped to the same tiers) and return findings without writing; a Judge that did not search reruns every P0/P1 command, merges duplicates, and writes one `cc-nexs-review` block. `rules/review-findings.md` defines the contract for all runtimes.
- `record-review --document-findings` derives the Review status from that block: only a P0/P1 failure demonstrated by a run and confirmed by the Judge rerun, or an unrefuted candidate/evidence mismatch, blocks. Trace-only findings are unproven, refuted findings are counted separately, P2/P3 are advisory, and malformed findings are rejected without blocking. The block must match the exact candidate, the round, and the finder lenses the risk tier requires.
- Unproven user-observable findings go to the Verifier as `probe:<id>` checks when the Review runs before test, and Gateway B lists them.
- `/cc-nexs:plan <id> --from <file>` takes a plan the user wrote in a runtime's plan mode; the Planner only normalizes it into requirements and approval scope.
- `/cc-nexs:init --auto-plan` sets `auto_plan` in the feature config, and `approve-plan --auto` passes Gateway A only for a fast-track, low/medium plan whose plan review is not blocked and whose task paths avoid schema/migration, auth/permission/secret, payment, and infrastructure/deployment paths.
- `/cc-nexs:verify-skill <repo> [--refresh]` writes or audits `.cc-nexs/verify/README.md` (launch, doctor, drive, evidence, cleanup) and a feature map in a code repository. `verify-guides <id>` lists each candidate repository's guide and feature entries from the exact candidate commit, and Verifiers drive the app through it.
- `record-test-verification --shard-json` records parallel shard Verifiers: every TV row must be assigned, every assigned check needs evidence, any blocked shard blocks, and the controller writes one merged acceptance section into `plan.md`.
- `stats --all [--since <date>]` aggregates every v2 Lean/Hotfix task in the workspace; task stats now separate auto and human approvals and skipped plan reviews, and count Review rounds, classified findings, and test verdicts.

### Changed

- The independent plan review runs for high/critical plans. A low/medium plan records `record-plan-review --skipped --reason`, bound to the plan hash; the controller refuses a skip for high/critical. The Plan Reviewer checks facts and must cite what a P0/P1 contradicts.
- Plans name the affected feature-map entries, each with a TV regression smoke.
- The Hotfix Reviewer can run checks and repros (Bash); Git mutation stays blocked by the existing hook.
- Legacy `record-review --passed|--blocked --finding` is refused once the review document holds a `cc-nexs-review` block.

## [0.13.1] - 2026-11-03

### Added

- The reference GitLab drivers work without API tokens. The Test driver with `--receipts <dir>` returns `awaiting_receipt` with an exact `record-receipt` command and turns what the signed-in GitLab pipeline or operations publication page shows into release evidence; a recorded pipeline identity never changes. The MR driver with `--receipts <dir>` resolves an MR that push options cannot create or report from a URL recorded with `record-mr`.
- `release-test` prints the driver's reason for a waiting attempt, and the run rule tells the Orchestrator to record only browser-observed facts with it.

### Fixed

- The reference GitLab Test release driver finds deploy jobs in child pipelines, requires every matching deploy job to succeed, keeps a manual gate or deploy job pending, and returns `awaiting_receipt` instead of an error when the token is missing or the API is unreachable.

## [0.13.0] - 2026-11-03

### Added

- `finish-base-sync <id> [--path <repo>:<path>]` completes a `sync-base` merge that stopped on conflicts. It stages the reported conflicts and named paths, refuses leftover conflict markers or unnamed changes, commits with the candidate and base as parents, and moves the candidate ref.
- `derived_binding: before-final-test` in the approved plan leaves declared derived paths at their base values through implementation and Test rounds. Once a candidate passes Test, `nextStep()` returns `bind_derived`; after the Developer runs the declared generator and Custodian forms the candidate, `record-derived-binding <id>` records it, and local verification, Review and one final Test attempt follow. The default `each-candidate` keeps the existing behavior.
- Reference GitLab drivers in `examples/drivers/`: `gitlab-mr-driver.mjs` creates or finds the MR from the feature branch at the exact candidate, and `gitlab-test-release-driver.mjs` reads pipelines through the API, accepts a later pipeline that contains a superseded integration, and can play named manual jobs.
- `stats <id>` reports active and elapsed time, Test attempts and deployments, conflict time, deploy wait, and human approvals from the event ledger.
- Plans list post-release steps as `- [ ]` lines in a post-release section. `status` and `finalize-docs` print the open ones, and a `COMPLETE` summary reports the task as merged, not live, while any remain.

### Changed

- A dedicated Test target (a branch other than the workspace `test_branch`) refuses integration with `TARGET_OCCUPIED` when it carries commits that are not in the base, the candidate, or the task's earlier integrations.
- The Test integration policy can mark a derived path "keep the Test side"; Test conflicts on it take the Test branch version unless the candidate changes content Test must show.
- When the test environment relaxes a production check, the plan puts the production-strict command for the affected area in the local verification matrix, and plan review treats relying on Test for it as P1.
- `advance --reason` is limited to 300 characters of plain sentences.
- Resume reads `cc-nexs status` and progress; an Orchestrator checkpoint whose revision differs from progress is only a hint and is rewritten.

### Fixed

- `reconcile` could not record `COMPLETE` for a task with a failed base release attempt. It now records the proven integration as a reconciled base attempt first.

## [0.12.0] - 2026-11-03

### Added

- Task files: Orchestrator-created files for a task belong in `.cc-nexs/runtime/tasks/<id>/`, with rebuildable copies (source exports, dependency installs, builds) only in its `scratch/`. `cc-nexs status` prints the path, and `reclaim-worktrees` removes the directory once the task is complete.
- `reconcile <id> [--confirm <token>]` records `COMPLETE` for a task whose work reached its bases outside the controller, such as a task from a retired mode or a manual merge. Every assigned code repository must prove its candidate, or branch commits beyond the recorded base, are in the base by ancestry or as equivalent patches, and the user confirms the exact plan shown. It never archives docs or deletes branches.

### Changed

- `reclaim-worktrees` also removes dependency and build caches (`node_modules`, `.next` and similar) in legacy `.cc-nexs/drafts/<task>/` directories of complete tasks. Other draft content and Git checkouts are reported for manual inspection.
- Progress from a retired mode is read as an active legacy task with a `reconcile` hint instead of being skipped. Unmerged branches report how many commits are patch-equivalent in the base. Leftover `cc-nexs-mr-*` branches from releases before 0.11.0 are listed with their merge status; remote branches are still never deleted.
- Lean and Hotfix Verifiers keep running every executable check after a failure and report all failures together.
- A Lean test repair fixes every reported failure in one round and passes locally (a `browser:` row or targeted test against the deployed test backend for frontend fixes) before the next deployment.

## [0.11.0] - 2026-11-03

### Added

- `finalize-docs <id>` creates the final docs candidate of a `COMPLETE` task, integrates it through the same route as code (MR driver or non-force push), and removes the docs worktree, branches and candidate ref after remote proof. It refuses before committing when the docs worktree holds files outside the archived paths, and a rerun resumes a pending docs MR.
- `base-preflight <id>` checks each configured base read-only before Gateway B. A base that can no longer take the candidate unchanged moves the task to `BASE_CHANGED` (Hotfix: `HOTFIX_BASE_CHANGED`) so it is synchronized before anyone is asked to approve it.

### Changed

- **Protected-base MRs come from the feature branch.** With `release.base.driver` configured, the MR source is the assigned feature or Hotfix branch at the exact approved candidate. The controller no longer creates a synthetic merge commit or a `cc-nexs-mr-<repo>-<commit>` branch. Sensitive-path checks run on a local merged tree that is never pushed, and the proof records that tree.
- **Driver contract.** `ensure_merge_request` now receives `{repository, sourceBranch, sourceCommit, targetBranch, targetBefore}` without `integrationCommit`. The driver pushes `sourceCommit` to `sourceBranch` (non-force) and finds or creates the MR. Drivers that validated the old branch name or merge parents must be updated.
- A merge is proven only when the target merged the candidate itself (first-parent chain or direct parent of a first-parent merge). A source that moved beyond the candidate is `MR_SOURCE_DRIFT`. After proof the remote feature branch is deleted.

### Fixed

- A release-base rerun after the MR merged recorded the MR as still pending and overwrote `target_before`. Reruns now keep the first `target_before` and MR and add the merge commit and its relation.
- The final docs candidate cleared the archived task's release approval and Review evidence, so a `COMPLETE` archive showed `release.approved=false`. It now keeps them.

## [0.10.0] - 2026-11-02

### Added

- `amend-plan` and `record-amendment-review` record extra paths needed to close an approved AC in a reviewed ledger outside `APPROVAL-SCOPE`. The Gateway A binding and existing approvals stay valid, and no human question is needed. New ACs, crossed non-goals, weakened checks, and permission, data, infrastructure, public-contract, or production changes still use `scope`.
- Lean plans declare baseline fast-check results, terminal-consumer sampling, Test operations authorized once at Gateway A, and a Test integration policy. Planner and Plan Reviewer treat them as part of the plan.
- `cc-nexs status` prints delivery milestones for the current candidate and the attempt blocking them; questions and blocker reports to the user must state them.

### Changed

- A `scope` request is also accepted from `LOCAL_VERIFY_FAILED`, `LOCAL_REVERIFY_FAILED`, and `TEST_MERGE_CONFLICT`, which previously had no route back to Gateway A.
- Integration-only Test conflicts may regenerate declared derived paths, and integration checks are not added to the plan as new gates.

## [0.9.0] - 2026-11-02

### Added

- Driver runs get a managed attempt directory, `.cc-nexs/runtime/verify/<task>/<attempt>/`. The payload carries `scratch_dir`, removed when the attempt ends on success and failure alike, and `artifacts_dir`, which is kept with the driver logs and a receipt holding their hashes. Scratch stays when it holds a dirty Git checkout or the driver's result names it.
- `doctor --worktrees` and `reclaim-worktrees` list `.cc-nexs/runtime/verify/`, keeping running attempts and the logs of active tasks and reclaiming the rest through the existing confirmation token.
- Local verification checks free space against `workflow.local_verify.min_free_gb` (default 10; 0 disables it) on the workspace and candidate worktree volumes. Below it, inactive scratch is reclaimed once; if a volume is still too low, verify-local stops with a blocker. `verify-local --preflight` runs the same check for the direct-evidence path.
- Local verification matrices accept `browser: <start command> @ <page path>` rows. The parent Orchestrator runs them and records `method: "browser"`, the exact command, and concrete `proof` instead of an exit code; a passing result still needs one executed command.

### Changed

- Local verification is now defined as a fast check before test acceptance: frontend lint, type check, targeted tests, and browser checks; backend targeted tests; and a full production build only when the change touches build configuration, dependencies, lockfiles, route generation, or publishing.
- Hotfix Developers run targeted checks and leave the frozen matrix to `verify-local`.
- Integration-only test conflicts are checked with targeted tests in the recorded worktree, without a source export or full production build.

### Fixed

- The local verification matrix parser now reads the `Command/Driver` column used by the en-US Lean and Hotfix templates, so those matrices are bound and enforced.

## [0.8.0] - 2026-10-30

### Added

- `cc-nexs status <id>` prints the feature's state, revision and `nextStep()` result (next state, action, role, stop, circuit breaker). `cc-nexs advance <id> --from <state> --to <state>` persists one run-loop transition and rejects a stale `--from`. `buildWorkflowSnapshot()` builds the `nextStep()` input from progress and config, replacing the hand-assembled snapshot in `run.md`.

### Changed

- **`release.base.driver` now pushes the MR source branch itself.** The controller no longer pushes `cc-nexs-mr-<repo>-<commit>` before calling the driver, so GitLab `merge_request.*` push options create the MR instead of being ignored on an unchanged ref. A pending receipt is rejected unless `origin/<sourceBranch>` equals the integration commit. Drivers that only call an API and relied on the controller's push must now push the branch.
- A Lean feature in `TEST_VERIFY_FAILED` can run `request-release-changes --type scope` when the fix needs paths or ACs outside the approved plan. It follows the existing scope path back to Gateway A and keeps the branch, worktrees and failed attempt. Each change request records `from_state`.
- `run-lean.md` limits `deferred_to_test` to checks the local environment kept from running. A check that ran and failed an assertion stays `failed`, even when it also fails on the base commit.

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
