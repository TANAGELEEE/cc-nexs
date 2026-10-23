---
description: "Optional requirements clarification entry point: completes requirements.md; when requirements are complete, proceeds directly to the planning step of the current mode."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Bash"
argument-hint: "<requirement id>"
---

# /cc-nexs:brainstorm

Use the [brainstorming skill](../skills/brainstorming/SKILL.md) to clarify the specified requirement. This command does not add a separate approval point.

1. Require an explicit requirement id; locate the unique requirement directory from the workspace-configured docs repository and progress assignment, validating `CC_NEXS_REQ_DIR` first. Do not guess the directory from the first glob match.
2. Read requirements.md, config.json, and the authoritative progress.json. If files are missing, modes are inconsistent, or only progress.md exists, report the specific problem and do not guess state from Markdown.
3. Edit requirements only when in `INIT` and no scope has been approved. For Lean, use the scope path of request-release-changes when in RELEASE_PENDING_HUMAN; for other states, return the planning change entry point of the current mode, do not modify the approved scope in this command, and do not bypass gates with interactive shell `read`.
4. Complete requirements.md according to the skill. When the problem is already clear, form the draft directly; do not force questions, option comparisons, or section-by-section confirmation.
5. Return the file path, key gaps, and the next step for the mode: `/cc-nexs:plan <id>` for Lean. If continuation is authorized and there are no key gaps, execute the next step; otherwise, this brainstorming session ends here.

Output only requirements.md; do not create additional design documents and do not modify progress.json/progress.md. Single-file copy fixes do not require this command; Hotfix uses a separate hotfix flow.
