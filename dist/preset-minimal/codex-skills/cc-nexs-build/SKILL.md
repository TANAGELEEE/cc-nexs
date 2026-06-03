---
name: cc-nexs-build
description: /cc-nexs:build 的 Codex 镜像 skill。 当用户输入 "/cc-nexs:build"、"/cc-nexs:build ..."、"$cc-nexs-build" 或要求执行 cc-nexs build 流程时触发。 按 git diff + cc-nexs.config.yml 的 paths_override.modules 规则，自动选择并执行需要跑的 build / test 命令。跨模块改动会顺序跑命中的所有模块；任一失败 fail fast。
---

# /cc-nexs:build for Codex

This skill is the Codex mirror for `/cc-nexs:build`. It exists so the Codex plugin can preserve the same command surface, workflow semantics, document write locations, and full / fast / hotfix behavior as the Claude Code plugin.

## Authoritative Command

Read and follow `../../commands/build.md` as the single source of truth for this command. Treat the user's original message after `/cc-nexs:build` as the command arguments.

## Execution Contract

1. Preserve every document path declared by the command file. Do not relocate `all-docs/doc/{id}.{slug}/`, `doc/{id}.{slug}/`, `bugs/`, `qa-scripts/`, `docs/solutions/`, or any command-specific artifact.
2. Preserve the command's state-machine contract. If the command says a single-step command must not advance `progress.md`, do not advance it; if `run` is the orchestrator, let `run` own state transitions.
3. Preserve mode behavior exactly:
   - `full`: five-role SOP with Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, and sprint loop.
   - `fast`: three-role flow with Fullstack / Reviewer / Verifier, single sprint, stricter thresholds, and no TECH_LEAD_REVIEW fallback.
   - `hotfix`: bypass flow with P0/P1/P2/P3 grading, BUG document writes, and escalation back to full SOP when the hotfix boundary is exceeded.
4. When the command references a Claude Code `Task` tool or `claude-subagent`, reproduce the role boundary inside Codex by using the role's agent prompt from `../../agents/`, setting the equivalent `CC_NEXS_ROLE` discipline in your own execution, and returning only the role's expected artifact.
5. When the command references a Codex CLI reviewer role, keep it as a separate Codex role invocation or separate reasoning pass. Do not merge QA / Evaluator / Reviewer outputs unless the fast-mode command explicitly says that role is merged.
6. When a shell snippet references `$CLAUDE_PLUGIN_ROOT`, translate it to the installed Codex plugin root that contains this skill. In shell commands prefer `PLUGIN_ROOT=<plugin-root>` or `CC_NEXS_PLUGIN_ROOT=<plugin-root>` or substitute the absolute plugin root directly.
7. Before editing or creating files, inspect the relevant command, agent, template, and current feature directory. Follow existing repo patterns and keep unrelated files untouched.
8. Run the verification steps requested by the command. If a step cannot be run in the current Codex surface, record the exact limitation and preserve the command's expected stop/gate behavior.

## Document Write Map

These are fixed cc-nexs locations, not Codex-specific alternatives:

- Feature docs: `all-docs/doc/{id}.{slug}/requirements.md`, `repo-context.md`, `spec.md`, `sa-review.md`, `dev-plan.md`, `api-doc.md`, `deploy.md`, `test-cases.md`, `sa-test-review.md`, `test-report.md`, `sa-code-review.md`, `acceptance.md`, `progress.md`, and `README.md`.
- Bug docs: `all-docs/doc/{id}.{slug}/bugs/BUG-*.md`, plus hotfix or QA repro assets under `all-docs/doc/{id}.{slug}/qa-scripts/`.
- Compound learnings: `docs/solutions/<topic>.md` plus the command-specific feature summary when `/cc-nexs:compound` requests it.
- Document repo commits: when `all-docs/` is its own git repo, add only `doc/{id}.{slug}/` or the command-declared bug path and keep code-repo files out of that commit.

## Full / Fast / Hotfix Mode Locks

- `full`: preserve Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, sprint slicing, artifact completeness gate before Evaluator, single human gate after spec approval, and README sync around every state transition.
- `fast`: preserve Fullstack / Reviewer / Verifier roles, single sprint, stricter counters, merged Reviewer acceptance parsing, Verifier black-box testing, no SA test-case review, and no TECH_LEAD_REVIEW fallback.
- `hotfix`: preserve P0/P1/P2/P3 grading, P3 direct-fix boundary, P2 BUG file plus repro plus SA-light-review loop, P0/P1 Evaluator section plus regression case plus rollback section, and escalation to full SOP when hotfix boundaries are exceeded.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by `../../commands/build.md` are present in the original cc-nexs locations.
