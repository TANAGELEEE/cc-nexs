# Runtime model discovery

Model lists belong to the execution host, not the project overlay. The shared
resolver accepts `modelCatalog` and an optional `modelProposal` with `model`,
`effort`, and a concrete selection `reason`. Existing explicit model IDs still
win. Unknown models, executor mismatch and advertised unsupported effort fail
before dispatch. With no reliable proposal, retain inheritance.

## Runtime paths

| Executor | Discovery | Dispatch |
| --- | --- | --- |
| Codex native | Current spawn tool metadata | Native independent agent |
| Codex CLI, including Claude-hosted external reviews | `node <plugin-root>/lib/model-discovery.mjs codex` | Existing external review adapter |
| Pi session | `cc_nexs_models` tool, using session model registry | Installed supported subagent API |
| Pi standalone | `node <plugin-root>/lib/model-discovery.mjs pi` | Explicit provider/model selector |
| Claude native | Actual Agent tool selectors; otherwise inherit | Independent native Agent |

Catalog discovery does not spend inference tokens, test connectivity, rank models,
or expose provider credentials. Reuse workspace-local cached catalogs and successful
combinations. Refresh on explicit request, host/account changes or actual model
availability failures, not at every batch. No maintained model registry is added
to the repository. A refresh does not invalidate
business scope or completed validation. Selection uses documented host capability
metadata; names and version numbers alone are not a quality benchmark.

## Overlay compatibility

Overlay remains optional, not a required model list. It still supplies stack,
build/test/lint commands, review rules, paths, workflow, local verification drivers,
and test release/environment safety settings. It can also override broader preset
fields. Do not remove it or silently discard pinned models. Moving everything to
project config requires a separate effective-config comparison because not every
overlay field has an equivalent project-level override today.

`models.roles` and concrete `models.profiles` entries can be removed when their
purpose was merely selecting old model versions. Preserve custom risk routing
references: remove or retarget dangling custom profile references together.
Do not remove preset `roles.definitions` (role responsibilities/tools) or unrelated
overlay stack/workflow/release rules. Existing explicit model pins remain active
until the user changes them; the gateway does not silently delete configuration.

## Advisory model preview and remembered combinations

Use `modelGateway` or `cc-nexs model-gateway <operation> --request <json-file>`.
The lifecycle is `inspect -> prepare -> start -> result`; user feedback is optional.
There is no wait timer and no extra approval state. Show the table only on first
use or a changed combination. If feedback arrives before `start`, it changes that
batch; otherwise it changes the next matching batch. Running roles stay frozen.

Learned choices that disappear from a refreshed catalog produce a structured `selectionNotice` and a warning in the preview before falling back to host inheritance. Explicit pins and user preferences still fail rather than silently changing. Cache keys use the role's resolved model, executor, effort and routing policy, not unrelated roles or the whole configuration. Existing old-key history is retained but is not reused after this key-format change.

Gateway locks recover only when a recorded owner PID is confirmed dead. Live, missing or malformed ownership metadata remains busy; it must not be removed just because it is old.

The cache is scoped to workspace and non-secret host/account/provider revision/
active model context. Successful choices are further scoped by role, difficulty,
risk/profile and effective model policy. It does not learn from plans or failed
business tests. Provider failures invalidate the affected catalog. User choices
take precedence over learned defaults. A cached success proves connectivity in
that context, not capability superiority or continued provider health.

Parent difficulty assessment is recorded with evidence: `routine` means known
patterns and a closed contract; `moderate` means several known callers/integration
steps; `complex` means unresolved root cause, cross-system coupling, concurrency
or recovery reasoning. Risk routing remains independent.

Pi exposes `cc_nexs_model_gateway` directly. Claude and Codex use the same shared
controller with their existing execution tool. No global host configuration is
rewritten; state and preview Markdown are under `.cc-nexs/model-dispatch/`.

## Live checks, 2026-10-13

- Codex app-server `model/list`: 69 model records discovered.
- Codex native subagent with `remote-magpie/group/auto-gpt-6-luna`: returned
  `CC_NEXS_MODEL_PROBE_OK` without tools or repository access.
- Pi RPC registry: 78 model records discovered.
- Pi direct inference with `magpie/group/auto-gpt-6-luna`: returned
  `CC_NEXS_PI_PROBE_OK`, tools/extensions/MCP/context files disabled.
- Installed Pi `@tintinweb/pi-subagents` 0.14.3: a real `Agent` call selected
  `magpie/group/auto-gpt-6-luna`; isolated child returned `CC_NEXS_PI_CHILD_OK`,
  one turn and zero tool uses. Probe files were outside the repository.

Pi dispatch now uses `cc_nexs_dispatch`, which runs each role as its own headless
Pi process in the assigned worktree; the subagent packages above are no longer used.
Completion, not spawn acceptance, determines whether a choice is remembered.
