---
description: "Render the Lean plan Markdown as a human-friendly temporary HTML page."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id]"
---

> The user invoked this command and its instructions are loaded below: follow them now. Do not call the Skill tool for it.

# /cc-nexs:render-plan

Run the packaged deterministic renderer:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs render-plan <feature-id>
```

It writes HTML under the operating-system temporary directory and prints the absolute path. HTML is never committed or edited; `plan.md` remains the single plan source.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and resolve models with `cc-nexs dispatch <id> --role <role> --reason "<task>"`: show its preview when it prints one, start immediately without waiting for a reply, and record the actual result with `dispatch-result`. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
