---
description: "Render the Lean plan Markdown as a human-friendly temporary HTML page."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id]"
---

# /cc-nexs:render-plan

Run the packaged deterministic renderer:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs render-plan <feature-id>
```

It writes HTML under the operating-system temporary directory and prints the absolute path. HTML is never committed or edited; `plan.md` remains the single plan source.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
