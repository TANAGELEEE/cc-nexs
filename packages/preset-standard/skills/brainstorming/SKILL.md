---
name: "brainstorming"
description: "Clarify ambiguous requirements and update requirements.md during an explicit cc-nexs brainstorm. Skip when the requirements are complete; not a general prerequisite step for writing code or planning."
disable-model-invocation: true
---

# Clarify Requirements

Use only when the user invokes brainstorm or the current flow explicitly requires clarification. The goal is to produce a requirements.md that the Planner can use, without adding approval gates beyond Gateway A / G1.

Read the located requirements.md, the current mode template, and the project materials directly relevant to the problem. Carry over the scope the user has already confirmed; fill in details that can be determined from the current state on your own. Ask only questions that affect business scope, acceptance, or authorization and that cannot be determined from existing information; closely related questions may be combined. While waiting for answers, continue drafting the independent parts.

Complete the requirements around context, user scenarios, priorities, non-goals, business rules, and external dependencies. The number of items follows the actual need; do not invent stories, alternatives, or non-goals just to fill a quota. Technical constraints may be recorded if they affect the business; detailed implementation plans are left to the Planner.

Modify only the requirements.md for the current requirement, preserving metadata and the change log; do not modify the spec, code, or progress, and do not dispatch implementation or review roles. If an approved scope already exists, follow the command-specified scope-change flow instead of rewriting the approved requirements directly.

Check for omissions, contradictions, and verifiability, and deliver a complete draft along with the questions still to be decided. There is no need to confirm section by section or re-approve items already confirmed. When the user only asked to brainstorm, stop after delivering the draft; when continuing to plan has been authorized and there are no critical gaps, Lean proceeds to plan and Fast/Full proceeds to run, with approval handled by the formal gates.
