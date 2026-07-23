# Pi P2 Support

cc-nexs provides experimental Pi support for the `preset-standard` fast and hotfix workflows. It uses the external [`pi-subagents`](https://github.com/nicobailon/pi-subagents) package for isolated role sessions and does not invoke Codex CLI.

## Supported boundary

Supported end to end:

- fast-mode init and run
- Repo Scout, Fullstack, Reviewer, and Verifier isolation
- G1 and G2 approval commands
- workspace-aware build and Git Custodian commands
- progress v2 state, counters, artifacts, and status/doctor commands
- P0/P1/P2/P3 hotfix grading, isolated repair/review/regression, and candidate recording

Not yet advertised as supported:

- full mode
- compound flow
- preset-minimal

The Pi skills fail closed for those modes instead of silently changing workflow semantics.

## Install

```bash
pi install npm:pi-subagents@0.35.1
pi install git:github.com/<github-owner>/cc-nexs
```

For local development:

```bash
pnpm install:local:pi
```

The local installer requires `pi-subagents` to be installed first, then builds and validates cc-nexs before registering this repository as a Pi package.

## Configure heterogeneous review

cc-nexs deliberately ships no Pi model IDs. Choose authenticated models from:

```bash
pi --list-models
```

Then configure project-local `.pi/settings.json`. Replace the example model names with entries from the local Pi catalog:

```json
{
  "subagents": {
    "agentOverrides": {
      "cc-nexs.reviewer": {
        "model": "review-provider/review-model",
        "thinking": "high",
        "fallbackModels": ["backup-provider/backup-review-model"]
      },
      "cc-nexs.verifier": {
        "model": "review-provider/review-model",
        "thinking": "high",
        "fallbackModels": ["backup-provider/backup-review-model"]
      }
    }
  }
}
```

Fullstack inherits the active Pi default unless explicitly overridden. Reviewer and Verifier must resolve to a different authenticated model before `/cc-nexs:run`; otherwise the P2 runtime stops instead of treating independent context as heterogeneous review.

The same model rule applies to hotfix. P2 uses Fullstack for implementation and a fresh Reviewer for the light code review. P0/P1 additionally uses a fresh Verifier for the regression case and a separate fresh Reviewer target that carries the Evaluator's local contract-scoring responsibility.

Check the live mapping after changing settings:

```text
/reload
/subagents-doctor
/subagents
```

The `/subagents` selector shows package agents and their resolved models. `/subagents-models` only accepts pi-subagents builtins, so it is not a valid check for `cc-nexs.*` roles.

`fallbackModels` is owned by pi-subagents and is the portability mechanism when a provider, channel, quota, or model is unavailable. The public cc-nexs preset remains provider-neutral.

## Commands

Pi registers the same P2 slash surface:

```text
/cc-nexs:init "需求描述"
/cc-nexs:run 01
/cc-nexs:approve-spec 01
/cc-nexs:approve-deploy 01
/cc-nexs:hotfix "支付回调偶现 500" 01
/cc-nexs:status 01
/cc-nexs:doctor
```

Each slash command forwards to a generated Pi skill. The skill reads the same `dist/preset-standard/commands/*.md` document used by the other runtimes, then replaces only the role-dispatch mechanism.

`approve-spec` and `approve-deploy` are exceptions to prompt-only dispatch: the Pi extension calls the shared deterministic core command first, then resumes `/skill:cc-nexs-run`. Pi never edits progress files through model-generated patches.

G1/G2 only pause cc-nexs role dispatch. They do not block the parent Pi session from performing user-authorized Git, SQL, SSH, deployment, diagnostics, or documentation work.

Hotfix remains a bypass flow. It does not advance the feature progress state and may attach to an existing fast or full feature. P3 is limited to a non-logic single-file diff of at most 20 lines; P2 adds BUG/repro, isolated review, and regression; P0/P1 additionally requires a regression case, local AC scoring, and a production rollback section when applicable. Boundary violations stop and escalate to a new full workflow.

## Security boundary

Package-qualified child roles run with explicit Pi tool allowlists. The cc-nexs Pi extension detects `PI_SUBAGENT_CHILD_AGENT` and blocks:

- Git mutation from role children
- role-forbidden reads and writes such as Reviewer reading `src/`
- Fullstack writing progress, review, acceptance, or test-report artifacts

The parent orchestrator remains responsible for state transitions and Git Custodian operations. Pi packages and child tools still execute with the user's operating-system permissions; use Pi project trust and review package source before installation.
