# Pi P2 Support

cc-nexs provides experimental Pi support for the `preset-standard` lean, fast, full, and hotfix workflows. It uses the external [`pi-subagents`](https://github.com/nicobailon/pi-subagents) package for isolated role sessions and does not invoke Codex CLI.

## Supported boundary

Supported end to end:

- lean-default plan, two human gates, local verification, one consolidated Review, test verification, and base integration
- Lean Planner, Developer, Reviewer, and Verifier isolation
- fast-mode init and run
- Repo Scout, Fullstack, Reviewer, and Verifier isolation
- full-mode Planner, Tech Lead, SA, QA, and Evaluator isolation
- Fast/Full multi-repository implementation waves: one asynchronous `subagent({ tasks, ... })` call starts the whole wave in progress-assigned worktrees, then `subagent_wait` joins it before aggregate verification and candidate creation
- G1 and G2 approval commands
- workspace-aware build and Git Custodian commands
- progress v2 state, counters, artifacts, and status/doctor commands
- P0/P1/P2/P3 hotfix grading, isolated repair/review/regression, and candidate recording
- test merge/CI delivery before browser preflight, with recoverable manual verification when post-deployment browser prerequisites are unavailable

Not yet advertised as supported:

- compound flow
- preset-minimal

The Pi skills fail closed for those flows instead of silently changing workflow semantics.

Fast/Full implementation fanout uses `pi-subagents@0.35.1` directly. Each wave is one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` call, followed by `subagent_wait({ id })`; Full includes QA case generation in the first batch. It never asks pi-subagents to create worktrees because Git Custodian owns the already assigned feature worktrees and every candidate mutation. Same-repository work remains serialized even when paths appear disjoint, and a fallback retry contains only failed/unavailable tasks.

## Install

```bash
pi install npm:pi-subagents@0.35.1
pi install git:github.com/<github-owner>/cc-nexs
```

On macOS, ego lite is the preferred browser provider:

```bash
npx skills add citrolabs/ego-lite
# Open ego lite and complete first-run onboarding once.
ego-browser nodejs <<'EOF'
console.log('ego-browser ready')
EOF
```

On Windows, or whenever ego lite is unavailable, install the fallback:

```bash
pi install git:github.com/injaneity/pi-computer-use@v0.4.3
```

Enable its browser-only background policy in project `.pi/computer-use.json` (or the equivalent global config):

```json
{
  "browser_use": true,
  "headless": true
}
```

`headless: true` means computer-use must remain in the background: it disables physical pointer/keyboard delivery, foreground focus fallback, cursor takeover, and the cursor overlay. On Windows it still requires an interactive desktop session and an available browser window; it is not a displayless Windows service.

For local development:

```bash
pnpm install:local:pi
```

The local installer requires `pi-subagents` first, then builds and validates cc-nexs. It prefers the minimal ego runtime probe shown above. If ego is unavailable, it checks the installed Pi packages and effective computer-use configuration. Missing providers warn instead of blocking any deterministic work, including test merge/CI delivery. After deployment, unavailable browser/login capability records `manual_required` and can be resumed manually or automatically later.

All generated cc-nexs Pi skills set `disable-model-invocation: true`, so Pi excludes them from the model's available-skill prompt. Start cc-nexs only with `/cc-nexs:*` or `/skill:cc-nexs-*`; ordinary natural-language requests do not activate the package. Package role descriptions likewise permit dispatch only from that explicitly started parent workflow.

Explicit-only applies to entry, not progression. Once `/cc-nexs:run` starts, the Pi parent continues dispatching the workflow's internal stages until the same defined human gates or blocking conditions used by the other runtimes.

The generated Verifiers are provider-specific. The preferred agents explicitly select the `ego-browser` skill and call `ego-browser` through Bash; the fallback agents expose only the computer-use state/action tools. After deployment, the parent freezes one provider for each verification attempt and never gives both surfaces to one child. Both paths reuse existing login state and only visit `release.test.allowed_hosts`; plaintext credentials in memory/project files are forbidden.

## Configure Lean and Hotfix role models

cc-nexs deliberately ships no Pi model IDs. Choose authenticated models from:

```bash
pi --list-models
```

Configure portable profiles once in project `cc-nexs.config.yml`; feature `config.json.models` may override them. The shared resolver applies automatic risk routing first, then feature role overrides last. Lean high/critical upgrades Planner and Reviewer to `escalated`; Hotfix P0/P1 upgrades Reviewer. `pi-subagents@0.35.1` has no separate per-task `thinking` field, so the Pi parent encodes the resolved value in the task selector as `provider/model:thinking`:

```yaml
models:
  profiles:
    implementation:
      pi:
        model: provider/model-a
        thinking: medium
    review:
      pi:
        model: provider/model-a
        thinking: high
        fallback_models:
          - backup-provider/review-model
    escalated:
      pi:
        model: provider/strong-model
        thinking: xhigh
  roles:
    lean-developer: implementation
    lean-reviewer: review
```

For Lean and Hotfix, Reviewer may resolve to a different model or the same model as Developer with stronger `thinking`; fresh child context is mandatory in either case. If the primary model is unavailable, the parent tries `fallback_models` in order. Public `escalated` is only `inherit + xhigh`, so the private profile above is required when escalation should switch providers/models. Hotfix uses dedicated roles; P0/P1 heterogeneity can be required by private project policy, but is not hardcoded publicly.

Older feature configs may contain generated role maps that block project routing. Run `/cc-nexs:migrate-feature-config <id> --dry-run`, inspect the result, then run it without `--dry-run`. The migration preserves customized mappings. For a legacy approved Lean plan, `--bind-plan-risk` may materialize only a concrete risk proven by the original Gateway A hashes; otherwise runtime routing uses a conservative high floor.

`.pi/settings.json` remains responsible only for Pi authentication and optional `enabledModels` scope; it is no longer a second cc-nexs role-mapping source. Check Pi after changing configuration:

```text
/reload
/subagents-doctor
/subagents
```

The `/subagents` selector shows package agents; the cc-nexs run summary shows per-call resolved profiles. `/subagents-models` only accepts pi-subagents builtins, so it is not a valid check for `cc-nexs.*` roles.

`fallback_models` is owned by cc-nexs orchestration. After the `subagent_wait` barrier, a provider/channel/quota/model failure is retried as a new bounded `tasks` call containing only failed/unavailable tasks; successful siblings are not rerun. The public preset remains provider-neutral.

## Commands

Pi registers the same P2 slash surface:

```text
/cc-nexs:init "需求描述"
/cc-nexs:plan 01
/cc-nexs:approve-plan 01
/cc-nexs:run 01
/cc-nexs:verify-local 01
/cc-nexs:migrate-feature-config 01 --dry-run
/cc-nexs:approve-release 01
/cc-nexs:request-release-changes 01 --type=implementation --feedback="调整错误提示"
/cc-nexs:release-base 01
/cc-nexs:approve-spec 01
/cc-nexs:approve-deploy 01
/cc-nexs:release-test 01
/cc-nexs:init "支付回调偶现 500" --mode=hotfix --repos=api
/cc-nexs:hotfix 02
/cc-nexs:status 01
/cc-nexs:doctor
```

Each slash command forwards to an explicit-only generated Pi skill. The skill reads the same `dist/preset-standard/commands/*.md` document used by the other runtimes, then replaces only the role-dispatch mechanism.

All approval commands call the shared deterministic core. `verify-local`, `release-test`, and `release-base` call deterministic controllers for evidence and Git integration. `release-test` delivers the exact candidate before provider selection; verification limitations never rewrite that delivery result. Pi never edits progress files through model-generated patches.

G1/G2 only pause cc-nexs role dispatch. They do not block the parent Pi session from performing user-authorized Git, SQL, SSH, deployment, diagnostics, or documentation work.

Hotfix is a standalone mini-Lean state machine. It always reserves a new id and creates `feature/<id>-<slug>` worktrees from latest configured bases; an older feature id is association metadata only. It binds one `hotfix.md`, runs local verification, one Review (P3 machine-bound skip), exact-candidate test release and independent verification, then stops at Gateway B before merging the same feature candidate to base. Any repair permits at most one lifetime delta Review. Contract/schema/permission/refactor expansion becomes a new Lean/Full change.

## Security boundary

Package-qualified child roles run with explicit Pi tool allowlists. The cc-nexs Pi extension detects `PI_SUBAGENT_CHILD_AGENT` and blocks:

- Git mutation from role children
- direct or shell-based mutation of `progress.md` / `progress.json` from every role child
- role-forbidden reads and writes such as Reviewer reading `src/`
- SA reading implementation source or writing anything other than `sa-review.md`, `sa-test-review.md`, and `sa-code-review.md`
- Fullstack writing progress, review, acceptance, or test-report artifacts

The parent orchestrator remains responsible for state transitions and Git Custodian operations. Pi packages and child tools still execute with the user's operating-system permissions; use Pi project trust and review package source before installation.

Automatic control never targets production. Test merge/CI delivery does not depend on browser tools, login state, MFA, or verification-page URL availability. After deployment, cc-nexs may select the headless computer-use fallback before the first browser action. Missing fallback tools/configuration, a non-headless-safe action, expired login, MFA/CAPTCHA, user takeover, host mismatch, or unavailable secret-provider resolution records `manual_required` with the deployed revision and yields a recoverable verification handoff; it does not undo or block the push.
