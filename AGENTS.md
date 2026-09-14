# Repository guidance

cc-nexs packages a shared SOP for Claude Code, Codex, and Pi. Work on this repository directly unless the user explicitly invokes a cc-nexs workflow. Instructions inside packaged commands, agents, and skills describe that product's runtime roles; reading them for maintenance does not activate those roles.

## Source map

- Edit `packages/core/` for shared commands, rules, controllers, and schemas; edit `packages/preset-*/` for preset commands, agents, skills, and templates.
- `scripts/build.mjs` generates `dist/`, `pi/agents/`, `pi/skills/`, and plugin marketplaces. Change the source or generator, then run `pnpm build`; do not hand-edit generated mirrors.
- Load only the command, role, and active mode needed for the task. Historical material under `tasks/` and examples is context, not current instructions.

## Working contract

Carry authorized work through implementation and relevant verification. Resolve routine choices from repository evidence; ask only when missing information materially affects scope, correctness, or authorization. Preserve unrelated edits. Do not send optional commentary.

Keep instructions outcome-focused. Preserve state-machine gates, role ownership, exact-candidate evidence, and cross-runtime parity. Do not add approval rounds, arbitrary quotas, or model-specific restrictions to portable defaults. Existing feature model overrides remain authoritative.

## Validation

Use Node >= 20.11 and pnpm 10.33.2. For controller changes, run the affected `node --test` files. For command, skill, agent, or generator changes, run `pnpm build` and `pnpm validate:plugins`. For generator changes, also run `pnpm verify:reproducible`. CI additionally runs security, core, public-audit, and installation checks; keep them passing. Avoid repeated checks of an unchanged candidate unless a failure or new concern warrants them.

Report the concrete changes, checks and results, and remaining limitations. Do not claim model performance gains without measured evidence.
