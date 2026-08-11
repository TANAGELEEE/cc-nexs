# Codex Plugin Support

cc-nexs ships a Codex plugin beside the Claude Code plugin. Both consume the same authoritative command documents, agents, templates, state machine, hooks, and document locations; generated Codex skills stay thin and contain only the runtime delta.

## Runtime isolation and models

Inside Codex, every role is dispatched as an independent native agent. The plugin does not start Claude Code and does not recursively invoke the Codex CLI. Implementer and reviewer contexts always remain isolated.

The public preset stores portable profiles only. Private project or feature config may assign each role a concrete model and reasoning effort. Automatic routing uses the shared deterministic core: Lean high/critical upgrades Planner and Reviewer to `escalated`; Hotfix P0/P1 upgrades Reviewer; a feature role profile remains the final override. The public `escalated` profile is `inherit + xhigh`, so a project must override that profile to switch to a concrete stronger model. Use only models exposed by the current native-agent override surface; top-level model-catalog visibility alone is not sufficient.

Inside Claude Code, all Lean roles use isolated Claude subagents, so Developer and Reviewer can use the same Claude model at different effort levels or different Claude models. Legacy full/fast SA/Evaluator/Reviewer roles retain their existing Codex CLI separation; executor-aware resolution uses the `codex` profile for those roles.

## Artifact Layout

`pnpm build` produces both plugin formats in each `dist/preset-*` directory:

- `.claude-plugin/plugin.json` for Claude Code
- `.codex-plugin/plugin.json` for Codex
- `commands/` as the authoritative command workflows
- `skills/` with the original Claude Code skills and their explicit-only invocation metadata
- `codex-skills/` with generated Codex command mirror skills
- `agents/`, `templates/`, `hooks/`, `lib/`, `schemas/`, `i18n/`, and preset docs

The Codex marketplace is generated at:

```text
.agents/plugins/marketplace.json
```

It points at the same built plugin roots as the Claude marketplace:

```text
./dist/preset-standard
./dist/preset-minimal
```

## Command Mirror

Codex plugins expose reusable workflows through skills. During build, every `commands/*.md` file is mirrored into a generated skill:

| Claude Code command | Codex mirror skill |
| --- | --- |
| `/cc-nexs:init` | `$cc-nexs-init` |
| `/cc-nexs:plan` | `$cc-nexs-plan` |
| `/cc-nexs:approve-plan` | `$cc-nexs-approve-plan` |
| `/cc-nexs:run` | `$cc-nexs-run` |
| `/cc-nexs:verify-local` | `$cc-nexs-verify-local` |
| `/cc-nexs:lean-review` | `$cc-nexs-lean-review` |
| `/cc-nexs:lean-verify` | `$cc-nexs-lean-verify` |
| `/cc-nexs:approve-release` | `$cc-nexs-approve-release` |
| `/cc-nexs:request-release-changes` | `$cc-nexs-request-release-changes` |
| `/cc-nexs:release-base` | `$cc-nexs-release-base` |
| `/cc-nexs:approve-spec` | `$cc-nexs-approve-spec` |
| `/cc-nexs:release-test` | `$cc-nexs-release-test` |
| `/cc-nexs:status` | `$cc-nexs-status` |
| `/cc-nexs:build` | `$cc-nexs-build` |
| `/cc-nexs:hotfix` | `$cc-nexs-hotfix` |
| `/cc-nexs:fullstack` | `$cc-nexs-fullstack` |
| `/cc-nexs:review` | `$cc-nexs-review` |
| `/cc-nexs:verify` | `$cc-nexs-verify` |
| `/cc-nexs:approve-deploy` | `$cc-nexs-approve-deploy` |

Every generated mirror has `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. Codex therefore omits it from the default model context and runs it only when the user selects or names the `$cc-nexs-*` skill. The original slash-style text remains as a compatibility hint, but it is not a native Codex slash command and must never be executed as a shell path:

This policy controls workflow entry only. After `$cc-nexs-run` is explicitly invoked, the orchestrator continues across internal stages until an existing human gate, release/verification block, circuit breaker, or genuine tool failure stops it.

```text
$cc-nexs-init "添加 /api/health 健康检查接口"
$cc-nexs-plan 01
$cc-nexs-approve-plan 01
$cc-nexs-run 01
$cc-nexs-approve-release 01
$cc-nexs-hotfix "支付回调偶现 500"
```

Each generated skill reads its matching `commands/*.md` file as the single source of truth and preserves its arguments, stop conditions, state transitions, and artifact paths.

Approval skills execute the deterministic approval core. `$cc-nexs-release-test` first executes the exact-candidate test merge/CI controller in `lib/cc-nexs-cli.mjs`; only after deployment does the Verifier inspect browser/login capability. These skills never edit `progress.json` directly or implement ad hoc Git integration.

Codex reuses the browser profile already logged into the test app/operations console. Browser availability, login/MFA state, and verification-page URLs are post-deployment verification inputs, never test merge/CI delivery gates. If they are unavailable, the deployed attempt records recoverable `manual_required` / `deployed_needs_manual_verification` evidence and can resume later without redoing delivery. Automatic navigation remains restricted to `release.test.allowed_hosts`. Plaintext account/password values in memory, Markdown, Git, or config are forbidden; only opaque external `credential_ref` values are allowed.

## Document Write Locations

Codex must write to exactly the same locations as Claude Code:

| Flow | Required locations |
| --- | --- |
| `lean` | `requirements.md` and `plan.md` are the only authored documents; `config.json`, `progress.json`, and `progress.md` are control files; HTML is rendered to a local temporary directory only |
| `full` | `all-docs/doc/{id}.{slug}/requirements.md`, `repo-context.md`, `spec.md`, `sa-review.md`, `dev-plan.md`, `api-doc.md`, `deploy.md`, `test-cases.md`, `sa-test-review.md`, `test-report.md`, `bugs/`, `sa-code-review.md`, `acceptance.md`, `progress.md`, `README.md` |
| `fast` | Same `all-docs/doc/{id}.{slug}/` directory, single-sprint artifacts, `repo-context.md` folded into Fullstack spec phase, `test-cases.md` + `test-report.md` from Verifier, `sa-code-review.md` + `acceptance.md` from Reviewer |
| `hotfix` | Its own `all-docs/doc/{id}.{slug}/hotfix.md`; `config.json`, `progress.json`, and `progress.md` are control files. It never writes into an older feature directory. |
| `compound` | `docs/solutions/<topic>.md` plus `all-docs/doc/{id}.{slug}/compound-summary.md` |

Generated Codex skills explicitly forbid relocating these paths.

## Lean / Full / Fast / Hotfix Parity

### Lean (default)

`mode=lean` keeps the low-token chain explicit:

1. Planner creates one requirements document and one plan document, with optional parallel read-only research.
2. Gateway A binds both documents by hash.
3. Developers execute non-overlapping plan tasks in per-repository worktrees and feature branches.
4. A deterministic local driver runs the available checks. If Lean has no driver, the parent runs only plan-approved commands and records exact command/exit/proof evidence; environment-only checks become structured `deferred_to_test` rather than repeated blockers. Hotfix still requires its driver.
5. The exact candidate is integrated to test and CI/deployment runs before any browser preflight.
6. The deployed environment is verified independently; a local web may target the deployed test backend. Missing browser/login/URL capability records recoverable `manual_required` instead of blocking delivery.
7. One independent consolidated Review reports all P0/P1 blockers; only one delta closure is allowed after fixes.
8. Gateway B binds the reviewed and test-verified fingerprint before non-force base integration; docs are finalized last.

Private model configuration uses ordinary nested YAML. The following intentionally uses the same model with stronger Review reasoning; set another model ID if heterogeneous Review is preferred:

```yaml
models:
  profiles:
    implementation:
      codex:
        model: your-model-id
        effort: medium
    review:
      codex:
        model: your-model-id
        effort: high
    escalated:
      codex:
        model: your-strong-model-id
        effort: xhigh
  roles:
    lean-developer: implementation
    lean-reviewer: review
```

New features use `config_version: 2` and `risk_tier: auto` without generated role mappings. For an older Lean/Hotfix feature, run `$cc-nexs-migrate-feature-config <id> --dry-run` and then the same skill without `--dry-run`; custom feature overrides are preserved. A legacy approved Plan risk is derived only from its exact stored scope hash; unknown legacy risk is conservatively routed as high. Use `--dry-run --bind-plan-risk` and then `--bind-plan-risk` to materialize a derivable risk with an audit event.

### Full

`mode=full` keeps the five-role SOP with Repo Scout pre-spec recon:

1. Repo Scout writes `repo-context.md`
2. Planner writes or revises `spec.md`
3. SA reviews `spec.md`, Sprint cases/code, then the complete integration candidate
4. Tech Lead implements Sprint slices, syncs docs, and fixes review/deployed defects
5. All Sprint development completes before one deterministic test release
6. QA runs accumulated tests on the deployed environment; Evaluator writes final `acceptance.md`

`$cc-nexs-run` remains the orchestrator entry. `$cc-nexs-approve-spec` records G1 and advances to `SPEC_APPROVED` through the shared control program.

### Fast

`mode=fast` keeps the three-role sequence:

1. Fullstack performs spec and implementation phases
2. Verifier writes and runs tests in the black-box role
3. Reviewer performs spec review and the combined code-review plus acceptance pass

Fast remains single-sprint only, uses stricter thresholds, skips SA test-case review, and has no TECH_LEAD_REVIEW fallback.

Both modes default to `auto_if_ready`; `--no-auto-test-release` explicitly opts out of automatic delivery. Driver/test-branch failures stop delivery, while browser/login/verification-URL limitations occur only after deployment and enter recoverable manual verification. Production release remains explicit and human-authorized.

### Hotfix

`/cc-nexs:hotfix` is a standalone `mode=hotfix` mini-Lean flow:

- initialize a new id, latest-base worktrees, and `feature/<id>-<slug>`;
- bind the sole `hotfix.md` scope, then implement and run the configured local driver;
- P0/P1/P2 get one independent concentrated Review; P3 skips only after deterministic single-file/20-line/non-behavioral proof;
- integrate the exact candidate to test, verify it in an independent session, then stop at Gateway B;
- merge the same feature candidate—not test—to configured base branches after approval.

Any repair consumes at most one lifetime delta Review. Contract/schema/permission changes or broad refactoring stop and become a new Lean/Full change. Reviewer may use another model or the same model at higher effort; independent native-agent context is mandatory.

## Hooks

The same hook scripts are packaged for both runtimes. The hook launcher resolves the
root inside Node instead of relying on shell expansion, so the same command works in
POSIX shells, PowerShell, and `cmd.exe`:

```text
PLUGIN_ROOT
CLAUDE_PLUGIN_ROOT
CC_NEXS_PLUGIN_ROOT
```

`PLUGIN_ROOT` is Codex's canonical plugin variable; `CLAUDE_PLUGIN_ROOT` keeps the
shared package compatible with Claude Code, and `CC_NEXS_PLUGIN_ROOT` is reserved for
direct local tests. There is deliberately no current-directory fallback because hook
commands run from the user's session directory, not the plugin directory.

Codex requires hook review and trust through `/hooks` before non-managed hooks run.

## Local Codex Install

```bash
pnpm install:local:codex
```

This command builds the artifacts, runs the plugin/SOP/runtime validators directly
through Node (avoiding Windows `pnpm.cmd` child-process lookup issues), and registers
the repo marketplace with Codex:

```bash
codex plugin marketplace add /path/to/cc-nexs
```

It also copies the built plugin roots into `~/.codex/plugins/cache/cc-nexs/`,
enables `cc-nexs@cc-nexs`, and disables `cc-nexs-minimal@cc-nexs` so mirror
skills and lifecycle hooks do not run twice. Use
`pnpm install:local:codex:minimal` to switch to the minimal preset; the installer
keeps the standard preset cached but disabled.

Then restart Codex or open a new thread, check `cc-nexs@cc-nexs` from `/plugins` if desired, and review hooks with `/hooks`.

## Validation

```bash
pnpm validate:codex
pnpm validate:claude
pnpm validate:sop
pnpm smoke:claude-install
```

The Codex validator checks:

- every `dist/preset-*` has `.codex-plugin/plugin.json`
- every command has a generated mirror skill
- generated skills point back to the authoritative command file
- every generated skill has `policy.allow_implicit_invocation: false` and an explicit `$cc-nexs-*` default prompt
- hook commands include Codex-compatible plugin-root fallbacks
- `.agents/plugins/marketplace.json` points at every Codex plugin artifact

The Claude Code validator checks the Claude install surface and explicit-only contract:

- `.claude-plugin/marketplace.json` still points at `./dist/preset-*`
- `pnpm install:local` still uses `scripts/install-local.mjs`
- generated Codex command mirror skills stay under `codex-skills/` and do not leak into Claude Code's `skills/`
- every Claude command and native skill sets `disable-model-invocation: true`
- plugin agents are routable only from an already explicit cc-nexs parent workflow
- `pnpm smoke:claude-install` runs `install-local.mjs` under a temporary HOME and checks Claude's installed plugin cache, known marketplace file, symlink, and enabled plugin settings without touching the real `~/.claude`

The SOP parity validator checks the lean / full / fast / hotfix load-bearing contract:

- `preset.yml` declares Lean as default plus all explicit legacy mode role sets and thresholds
- `init`, `run`, and `hotfix` commands still declare the expected document paths and mode branching rules
- generated Codex mirror skills still include the document write map and Lean / full / fast / hotfix mode locks
