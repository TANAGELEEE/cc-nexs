# preset-minimal

Generic minimal preset for `cc-nexs`. Three roles, single tool (Claude with subagent isolation), English by default, no language stack assumption.

## When to use

- Personal / individual projects
- Cross-language exploration / spike
- New project where the team hasn't yet decided on heavyweight SOP
- Starting point for forking a new domain-specific preset

## Roles

| Role | Tool | Responsibility |
|------|------|----------------|
| Planner | Claude subagent | Drafts `spec.md` (background, approach, scope, AC, optional sprint slices, change log) |
| Developer | Claude subagent | Implements code, fixes bugs, syncs docs |
| Reviewer | Claude subagent | Reviews spec, code, and acceptance (folds SA/QA/Evaluator into one role) |

Compared to `preset-nexs` which splits review across SA / QA / Evaluator with cross-tool isolation, `preset-minimal` keeps things lightweight.

## Workflow

```
INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING
   → ⏸️ SPEC_PENDING_HUMAN (single human gate)
   → SPEC_APPROVED → DEV → REVIEW (code) → TEST → [FIX → REGRESSION] → ACCEPTANCE
   → COMPLETE
```

`sprint_enabled: false` by default — the entire feature is one big slice. Set `true` in your project's `cc-nexs.config.yml` if you want sprint slicing.

## Install

```bash
ln -s /path/cc-nexs/packages/preset-minimal ~/.claude/plugins/cc-nexs
```

Then in your target project:

```bash
mkdir -p doc/01.feature-name
cp -r ~/.claude/plugins/cc-nexs/templates/* doc/01.feature-name/
# Edit doc/01.feature-name/requirements.md

/cc-nexs-minimal:run 01
```

## Customizing

To make a specialized preset (e.g., `preset-fastapi`), copy this directory and:

1. Update `preset.yml`: set `stack.type`, `build_cmd`, `test_cmd`, `forbidden_patterns`, `custom_review_rules`
2. Adjust `agents/*.md` to embed stack-specific guidance
3. Add domain-specific commands under `commands/` if needed
4. Adjust language in `i18n/<locale>/strings.json`

See [docs/extending-presets.md](../../docs/extending-presets.md).
