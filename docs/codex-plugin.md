# Codex Plugin Support

cc-nexs ships a Codex plugin beside the Claude Code plugin. Both consume the same authoritative command documents, agents, templates, state machine, hooks, and document locations; generated Codex skills stay thin and contain only the runtime delta.

## Runtime isolation and models

Inside Codex, every role is dispatched as an independent native agent. The plugin does not start Claude Code and does not recursively invoke the Codex CLI. Implementer and reviewer contexts always remain isolated.

The public preset stores portable profiles only. Private project or feature config may assign each role a concrete model and reasoning effort. Automatic routing uses the shared deterministic core: Explicit Lean high/critical can route the first Planner to `escalated`; risk discovered in the plan upgrades the Plan Reviewer and subsequent Reviewer without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; a feature role profile remains the final override. The public `escalated` profile is `inherit + xhigh`, so a project must override that profile to switch to a concrete stronger model. Use only models exposed by the current native-agent override surface; top-level model-catalog visibility alone is not sufficient.

Inside Claude Code, all Lean and Hotfix roles use isolated Claude subagents, so Developer, Plan Reviewer, and Reviewer can use the same Claude model at different effort levels or different Claude models. Cross-vendor adversarial review is out of scope; use the separate `nexs-sop` skill when it is required.

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

It points at the Codex-only distribution generated from the same sources:

```text
./dist/codex/preset-standard
```

Codex-only distributions rename `commands/` to `command-docs/` and omit `.claude-plugin/`. This prevents automatic legacy command migration from exposing a second `Source Command ...` skill alongside each native adapter. The native adapters reference the same command bodies. Reinstall the local plugin and restart Codex to replace an older migrated cache.

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
| `/cc-nexs:release-test` | `$cc-nexs-release-test` |
| `/cc-nexs:status` | `$cc-nexs-status` |
| `/cc-nexs:build` | `$cc-nexs-build` |
| `/cc-nexs:hotfix` | `$cc-nexs-hotfix` |

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
| `hotfix` | The assigned BUG document: related `doc/<id>.<slug>/bugs/BUG-<key>.md`, otherwise docs `hotfix/<key>/BUG-001.md`. Machine state/config remain in workspace `.cc-nexs/hotfixes/<key>/`; `progress.hotfix_document` locates the BUG. Legacy `hotfix.md` tasks remain resumable. |
| `compound` | `docs/solutions/<topic>.md` plus `all-docs/doc/{id}.{slug}/compound-summary.md` |

Generated Codex skills explicitly forbid relocating these paths.

## Lean / Hotfix Parity

### Lean

`mode=lean` keeps the low-token chain explicit:

1. Planner creates one requirements document and one plan document, with optional parallel read-only research.
2. An independent Plan Reviewer checks the plan against the requirements and the code; a blocked plan gets one revision and re-review, and open findings go to Gateway A.
3. Gateway A binds both documents by hash, requires the plan review for that exact plan, and refuses acceptance criteria that do not trace to a task, a local check, and a test check.
4. Developers execute non-overlapping plan tasks in per-repository worktrees and feature branches.
5. A deterministic local driver runs the available checks. If Lean has no driver, the parent runs only plan-approved commands and records exact command/exit/proof evidence; environment-only checks become structured `deferred_to_test` rather than repeated blockers. Hotfix may also record direct evidence for its frozen scope matrix; every required command must match and pass, and Hotfix cannot defer checks.
6. The exact candidate is integrated to test and CI/deployment runs before any browser preflight.
7. The deployed environment is verified independently; a local web may target the deployed test backend. Missing browser/login/URL capability records recoverable `manual_required` instead of blocking delivery.
8. One independent consolidated Review reports all P0/P1 blockers; only one delta closure is allowed after fixes.
9. Gateway B binds the reviewed and test-verified fingerprint before non-force base integration; docs are finalized last.

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
    lean-plan-reviewer: review
    lean-reviewer: review
```

For GPT-6 Astra, select it in the host or set the private profile's model to `gpt-6-astra` only when that native-agent surface exposes it. The existing `medium` implementation, `high` Review, and `xhigh` escalation profiles are starting points to evaluate, not a promise of optimal performance. Keep explicit feature overrides. Do not force every role to maximum effort or replace portable preset defaults. The [official Astra guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra) recommends auditing conflicting instructions, encouraging follow-through, specifying useful delegation, and calibrating verification to the task.

New features use `config_version: 2` and `risk_tier: auto` without generated role mappings. For an older Lean/Hotfix feature, run `$cc-nexs-migrate-feature-config <id> --dry-run` and then the same skill without `--dry-run`; custom feature overrides are preserved. A legacy approved Plan risk is derived only from its exact stored scope hash; unknown legacy risk is conservatively routed as high. Use `--dry-run --bind-plan-risk` and then `--bind-plan-risk` to materialize a derivable risk with an audit event.

Lean defaults to `auto_if_ready`; `--no-auto-test-release` explicitly opts out of automatic delivery. Driver/test-branch failures stop delivery, while browser/login/verification-URL limitations occur only after deployment and enter recoverable manual verification. Production release remains explicit and human-authorized.

### Hotfix

`/cc-nexs:hotfix` starts an independent repair without reserving a shared feature number:

- `hotfix` invokes the internal `init-hotfix` controller and creates `hotfix/<key>` and latest-base `.worktrees/<key>/<repo>/` assignments, plus one BUG document in docs; it never pushes placeholders.
- Bind paths, severity, required P0/P1 AC/rollback fields, and the local verification matrix in that BUG. `progress.hotfix_document` identifies it; local machine files live in `.cc-nexs/hotfixes/<key>/`.
- Run the configured driver or exact scope-bound commands with structured evidence, then independent consolidated Review for every severity, including P3. File/line counts cannot prove behavior or exempt Review.
- Deliver the exact candidate to test, verify it independently, then obtain Gateway B approval before integrating that candidate to configured bases.
- If actual test deployment succeeded but verification requires unavailable environment capability, explicit user authorization may use `approve-release --test-exception` with exact local/Review, environment, and rollback evidence. Preserve `manual_required`; this authorizes base integration only, not production deployment.

The existing delta/circuit limits remain. For an already-authorized revision of the same fault, `revise-hotfix` records the reason and authorization, rebinds in the existing key/branch, invalidates current evidence, and preserves history. Contract/schema/permission expansion uses `--promote-lean` to create `<BUGstem>.lean/` beside the BUG and return to Lean planning/Gateway A without a new reservation. Legacy `hotfix.md` tasks retain their compatibility path. Reviewer may use another model or the same model at higher effort; independent native-agent context is mandatory.

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
and enables `cc-nexs@cc-nexs`.

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

The SOP parity validator checks the lean / plan review / hotfix load-bearing contract:

- `preset.yml` declares Lean as default plus the Lean and Hotfix role sets and thresholds
- `init`, `run`, and `hotfix` commands still declare the expected document paths and mode branching rules
- generated Codex mirror skills still include the document write map and Lean / Hotfix mode locks
