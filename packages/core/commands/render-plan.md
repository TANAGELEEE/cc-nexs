---
description: Render the Lean plan Markdown as a human-friendly temporary HTML page.
allowed-tools: Read, Bash
argument-hint: [feature_id]
---

# /cc-nexs:render-plan

Run the packaged deterministic renderer:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs render-plan <feature-id>
```

It writes HTML under the operating-system temporary directory and prints the absolute path. HTML is never committed or edited; `plan.md` remains the single plan source.
