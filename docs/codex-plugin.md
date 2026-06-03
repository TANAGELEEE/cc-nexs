# Codex Plugin Support

cc-nexs now ships a Codex plugin side by side with the Claude Code plugin. The Codex package is not a simplified preset: it mirrors the same command documents, agents, templates, state machine, hooks, and document locations.

## Artifact Layout

`pnpm build` produces both plugin formats in each `dist/preset-*` directory:

- `.claude-plugin/plugin.json` for Claude Code
- `.codex-plugin/plugin.json` for Codex
- `commands/` as the authoritative command workflows
- `skills/` with the original Claude Code skills, unchanged
- `codex-skills/` with generated Codex command mirror skills
- `agents/`, `templates/`, `hooks/`, `lib/`, `schemas/`, `i18n/`, and preset docs

The Codex marketplace is generated at:

```text
.agents/plugins/marketplace.json
```

It points at the same built plugin roots as the Claude marketplace:

```text
./dist/preset-nexs
./dist/preset-minimal
```

## Command Mirror

Codex plugins expose reusable workflows through skills. During build, every `commands/*.md` file is mirrored into a generated skill:

| Claude Code command | Codex mirror skill |
| --- | --- |
| `/cc-nexs:init` | `$cc-nexs-init` |
| `/cc-nexs:run` | `$cc-nexs-run` |
| `/cc-nexs:approve-spec` | `$cc-nexs-approve-spec` |
| `/cc-nexs:status` | `$cc-nexs-status` |
| `/cc-nexs:build` | `$cc-nexs-build` |
| `/cc-nexs:hotfix` | `$cc-nexs-hotfix` |
| `/cc-nexs:fullstack` | `$cc-nexs-fullstack` |
| `/cc-nexs:review` | `$cc-nexs-review` |
| `/cc-nexs:verify` | `$cc-nexs-verify` |

The same raw command text also appears in the generated skill description, so typing the original slash-style command as a normal Codex prompt still routes to the mirror skill:

```text
/cc-nexs:init "添加 /api/health 健康检查接口" --mode=fast
/cc-nexs:run 01
/cc-nexs:hotfix "支付回调偶现 500"
```

Each generated skill reads its matching `commands/*.md` file as the single source of truth and preserves its arguments, stop conditions, state transitions, and artifact paths.

## Document Write Locations

Codex must write to exactly the same locations as Claude Code:

| Flow | Required locations |
| --- | --- |
| `full` | `all-docs/doc/{id}.{slug}/requirements.md`, `repo-context.md`, `spec.md`, `sa-review.md`, `dev-plan.md`, `api-doc.md`, `deploy.md`, `test-cases.md`, `sa-test-review.md`, `test-report.md`, `bugs/`, `sa-code-review.md`, `acceptance.md`, `progress.md`, `README.md` |
| `fast` | Same `all-docs/doc/{id}.{slug}/` directory, single-sprint artifacts, `repo-context.md` folded into Fullstack spec phase, `test-cases.md` + `test-report.md` from Verifier, `sa-code-review.md` + `acceptance.md` from Reviewer |
| `hotfix` | Existing feature's `all-docs/doc/{id}.{slug}/bugs/BUG-*.md`, optional repro assets under `qa-scripts/`, and the hotfix record committed to `all-docs` when configured |
| `compound` | `docs/solutions/<topic>.md` plus `all-docs/doc/{id}.{slug}/compound-summary.md` |

Generated Codex skills explicitly forbid relocating these paths.

## Full / Fast / Hotfix Parity

### Full

`mode=full` keeps the five-role SOP with Repo Scout pre-spec recon:

1. Repo Scout writes `repo-context.md`
2. Planner writes or revises `spec.md`
3. SA reviews `spec.md`, test cases, and code
4. Tech Lead implements, syncs docs, and fixes bugs
5. QA writes cases, runs tests, writes bug reports, and runs regression
6. Evaluator writes `acceptance.md`

`/cc-nexs:run` remains the only command that advances `progress.md`, except `/cc-nexs:approve-spec` for the human gate.

### Fast

`mode=fast` keeps the three-role sequence:

1. Fullstack performs spec and implementation phases
2. Verifier writes and runs tests in the black-box role
3. Reviewer performs spec review and the combined code-review plus acceptance pass

Fast remains single-sprint only, uses stricter thresholds, skips SA test-case review, and has no TECH_LEAD_REVIEW fallback.

### Hotfix

`/cc-nexs:hotfix` remains a bypass flow:

- P3: trivial fix path
- P2: normal hotfix path with BUG artifact and local verification
- P1/P0: escalated path with lightweight review and acceptance
- Boundary exceeded: stop and convert the bug to full SOP

Hotfix does not create a new feature directory unless the command explicitly escalates to full SOP.

## Hooks

The same hook scripts are packaged for both runtimes. Hook commands resolve the plugin root in this order:

```text
CLAUDE_PLUGIN_ROOT
PLUGIN_ROOT
CODEX_PLUGIN_ROOT
CC_NEXS_PLUGIN_ROOT
.
```

Codex requires hook review and trust through `/hooks` before non-managed hooks run. Local development can also set `CC_NEXS_PLUGIN_ROOT` when invoking hook scripts directly.

## Local Codex Install

```bash
pnpm install:local:codex
```

This command builds, runs `pnpm validate:plugins`, and registers the repo marketplace with Codex:

```bash
codex plugin marketplace add /path/to/cc-nexs
```

It also copies the built plugin roots into `~/.codex/plugins/cache/cc-nexs/`, enables `cc-nexs@cc-nexs`, and disables `cc-nexs-minimal@cc-nexs` by default so the generated `/cc-nexs:*` mirror skills do not appear twice. Use `pnpm install:local:codex:all` to enable both presets, or `pnpm install:local:codex:minimal` to enable only the minimal preset.

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
- hook commands include Codex-compatible plugin-root fallbacks
- `.agents/plugins/marketplace.json` points at every Codex plugin artifact

The Claude Code validator checks that Codex support has not changed the existing Claude install surface:

- `.claude-plugin/marketplace.json` still points at `./dist/preset-*`
- `pnpm install:local` still uses `scripts/install-local.mjs`
- generated Codex command mirror skills stay under `codex-skills/` and do not leak into Claude Code's `skills/`
- `pnpm smoke:claude-install` runs `install-local.mjs` under a temporary HOME and checks Claude's installed plugin cache, known marketplace file, symlink, and enabled plugin settings without touching the real `~/.claude`

The SOP parity validator checks the full / fast / hotfix load-bearing contract:

- `preset.yml` still declares full and fast mode role sets and thresholds
- `init`, `run`, and `hotfix` commands still declare the expected document paths and mode branching rules
- generated Codex mirror skills still include the document write map and full / fast / hotfix mode locks
