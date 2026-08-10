---
name: cc-nexs-approve-deploy
description: /cc-nexs:approve-deploy 的 Codex 镜像 skill。 仅当用户显式输入 "$cc-nexs-approve-deploy" 或在界面中选择该 skill 时使用；不得因普通自然语言请求自动触发。 Approve deploy gate G2 in authoritative progress.json v2, mirror the human-readable view, then resume via /cc-nexs:run.
---

# /cc-nexs:approve-deploy for Codex

This explicit-only skill is the Codex mirror for `/cc-nexs:approve-deploy`. It exists so the Codex plugin can preserve the same command surface, workflow semantics, document write locations, and lean / full / fast / hotfix behavior as the Claude Code plugin.

## Authoritative Command

Read and follow `../../commands/approve-deploy.md` as the single source of truth for this command. Treat the user's original message after `/cc-nexs:approve-deploy` as the command arguments.

## Deterministic Approval Control

Resolve `../../lib/cc-nexs-cli.mjs` relative to this SKILL.md and execute the packaged control program:

```text
node <resolved-cli-path> approve-deploy <feature-id> [M<N>]
```

Never execute `/cc-nexs:approve-deploy` as a shell path and never edit `progress.json` or `progress.md` directly. After the control program succeeds, continue the current runtime's run workflow.

## Execution Contract

1. Preserve every document path declared by the command file. Do not relocate `all-docs/doc/{id}.{slug}/`, `doc/{id}.{slug}/`, `bugs/`, `qa-scripts/`, `docs/solutions/`, or any command-specific artifact.
2. Preserve the command's state-machine contract. If the command says a single-step command must not advance `progress.md`, do not advance it; if `run` is the orchestrator, let `run` own state transitions.
3. Preserve mode behavior exactly:
   - `full`: five-role SOP with Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, and sprint loop.
   - `lean`: default plan-first flow with two authored documents, two human gates, deterministic local verification, one consolidated Review, test verification, and approved base integration.
   - `fast`: legacy three-role flow with Fullstack / Reviewer / Verifier, single sprint, stricter thresholds, and no TECH_LEAD_REVIEW fallback.
   - `hotfix`: standalone mini-Lean flow with its own latest-base feature worktrees, one hotfix.md, bounded Review, test verification, and a human base gate.
4. In Codex, every role runs as an independent native subagent using the role prompt from `../../agents/`. Never invoke Claude Code, a Claude subagent tool, or a nested `codex` CLI process. Runtime adaptation overrides any Claude-specific shell snippet in the authoritative command.
5. Keep implementation and review in distinct native agent sessions. Resolve automatic risk routing from one progress/config/approved-plan snapshot: Lean high/critical upgrades Planner and Reviewer; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Never pre-merge feature roles before routing. A Reviewer may use a different model or the same model with higher reasoning effort. Provider-specific IDs are allowed only in private project/feature config; public preset defaults remain portable and inherit when unspecified.
6. When a shell snippet references `$CLAUDE_PLUGIN_ROOT`, translate it to the installed Codex plugin root that contains this skill. In shell commands prefer `PLUGIN_ROOT=<plugin-root>` or `CC_NEXS_PLUGIN_ROOT=<plugin-root>` or substitute the absolute plugin root directly.
7. Before editing or creating files, inspect the relevant command, agent, template, and current feature directory. Follow existing repo patterns and keep unrelated files untouched.
8. Run the verification steps requested by the command. If a step cannot be run in the current Codex surface, record the exact limitation and preserve the command's expected stop/gate behavior.

## Document Write Map

These are fixed cc-nexs locations, not Codex-specific alternatives:

- Feature docs: `all-docs/doc/{id}.{slug}/requirements.md`, `repo-context.md`, `spec.md`, `sa-review.md`, `dev-plan.md`, `api-doc.md`, `deploy.md`, `test-cases.md`, `sa-test-review.md`, `test-report.md`, `sa-code-review.md`, `acceptance.md`, `progress.md`, and `README.md`.
- Hotfix record: `all-docs/doc/{id}.{slug}/hotfix.md` in an independently initialized hotfix feature.
- Compound learnings: `docs/solutions/<topic>.md` plus the command-specific feature summary when `/cc-nexs:compound` requests it.
- Document repo commits: when `all-docs/` is its own git repo, add only `doc/{id}.{slug}/` or the command-declared bug path and keep code-repo files out of that commit.

## Full / Fast / Hotfix Mode Locks

- `lean`: preserve the plan and release gates, two authored documents, exact worktree/candidate binding, deterministic local driver, one full Review plus at most one delta closure, and test-before-base integration.
- `full`: preserve Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, sprint slicing, artifact completeness gate before Evaluator, single human gate after spec approval, and README sync around every state transition.
- `fast`: preserve Fullstack / Reviewer / Verifier roles, single sprint, stricter counters, merged Reviewer acceptance parsing, Verifier black-box testing, no SA test-case review, and no TECH_LEAD_REVIEW fallback.
- `hotfix`: preserve latest-base isolation, immutable scope binding, P0/P1/P2/P3 impact grading, deterministic P3 boundary, one Review plus at most one lifetime delta, test verification, and Gateway B before base integration.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by `../../commands/approve-deploy.md` are present in the original cc-nexs locations.
