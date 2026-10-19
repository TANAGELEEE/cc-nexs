# GPT-6 Astra Instruction Audit

Review date: 2026-09-07. Scope covers the current repository's instruction sources, generated adaptation layers, and delivery workflows; the audit does not modify the user's global configuration, installed plugin caches, or existing feature configuration.

## Official References

- [GPT-6 Astra model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra): The model is more sensitive to skills and instruction files; the boundaries of sustained execution, necessary clarification, effective delegation, and appropriate verification should be explicit. This audit used this guidance to remove extra pauses and conflicting rules.
- [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md): Project instructions load hierarchically by directory. This audit added a concise root-level maintenance contract that distinguishes repository maintenance from packaged SOP role instructions.
- [Skill guidance](https://learn.chatgpt.com/docs/build-skills): Names and descriptions enter the discovery context first, while the body loads on demand. This audit shortened the mirror descriptions, retained the existing explicit-invocation policy, and continues to use commands as the source of workflows.

## Audit Scope and Handling

We inventoried 10 source SKILL.md files, 37 source commands, 20 source agents, plus core rules, standard workflows, templates, model routing configuration, generators, and GitHub CI. We searched across directories for approval, pause, role isolation, output limits, history rewriting, and model routing requirements, focusing on checking each source of conflict and its invocation sites one by one. The dist and Pi mirrors are synchronized by the build and are not edited as independent instruction sources.

| Issue | Action | Retained Contract |
|---|---|---|
| AGENTS.md was missing from the repository root, making it easy to mistake a product role for the current identity during maintenance | Added a source map, task boundaries, and validation entry points | SOPs explicitly invoked by the user still follow their original workflows |
| The brainstorming skill required every task to pass through it with section-by-section confirmation, conflicting with the command's optional semantics | Changed to clarification of critical gaps; complete drafts delivered in one pass; planning for the corresponding mode continues when authorized | Writes requirements only; does not change the approval scope or authoritative state |
| The brainstorming command read progress.md and allowed shell confirmation to bypass state restrictions | Reads progress.json; specifies the applicable states for the Gate B scope controller | Does not mistakenly route non-Gate B states into that controller |
| Commit count caps and Sprint squash can alter candidate history | Removed hard quotas, the rebase example, and duplicate approval prompts; synchronized the spec template | Git Custodian, immutable candidate, re-verification |
| The identity skill repeated the old five-party matrix, referenced a nonexistent .sh hook, and recommended git restore | Points to the current role contract and .mjs hook; repairs based on the ownership of the specific change | Independent Review, black-box role read/write boundaries, protection of others' changes |
| A uniform 2000-character limit and five-item cap could truncate findings; roles duplicated style rules | Output rules maintained centrally; length is subordinate to evidence completeness | Machine conclusion line, AC, candidate, and attempt binding |
| Documentation aggregation generalized the Fast/Full file lists to all modes | Specified that Lean writes a plan and Hotfix writes a hotfix; removed generic tail/grep state inference | Historical rounds and current candidate evidence |
| Unconditional lessons-learned prompt after completion | Prompt only when there are specific reusable lessons or the user requests it | Definition of done and final delivery summary |
| Model documentation can easily make a high-risk escalation look like restarting the Planner | Distinguishes the initial explicit risk escalation from a Reviewer escalation after the plan identifies risk | Single Planner, existing resolver, feature override takes precedence |

## Retention and Adaptation

Retain the public preset's inherit model and risk tiers. Astra can be selected by the current host or configured in a private profile that supports the model; medium / high / xhigh are existing starting points and should be evaluated against the real task rather than uniformly changed to the highest reasoning tier. See [Codex plugin documentation](codex-plugin.md) for the specific configuration entry point.

Retain the four-mode state machine, Gateway A/B, legacy G1/G2, serialized writes within the same repository, and the cross-repository wave barrier. They carry verifiable delivery constraints and must not be deleted as redundant text. Keep the short branch/worktree/merge compatibility skills. Historical CHANGELOG and task records retain their original form.

GitHub CI retains Node 20/22 and Windows coverage. This change affects prompts, templates, and adaptation descriptions; there is no evidence to support removing platform compatibility checks. Builds, reproducibility verification, and installation smoke tests rebuild shared generated directories, so they should run serially to avoid validation reading an intermediate state.

## Validation and Effect Boundaries

- 233 core tests passed, covering the state machine, approval binding, model routing, candidate, release, and worktree boundaries.
- 13 security and version consistency tests passed.
- Three-platform plugin validation, SOP parity, runtime portability, and isolated installation smoke tests passed.
- The reproducible build passed, including LF/CRLF source consistency.
- Static scenario review: simple copywriting does not enter the brainstorming flow; complete requirements need no extra Q&A; a request for only a brainstorming draft ends after delivery; approval scope changes are not implemented directly; code changes do not reuse an old PASS; long reviews retain complete findings.

The five key files (brainstorming command/skill, commit skill, role-isolation skill, and output rule) fell from 14,727 Unicode characters to 3,430, a reduction of 76.7%. This is only a text-length change and does not equate to improvements in token usage, latency, or success rate. This audit did not run a real Astra A/B behavioral evaluation or perform production delivery.

Future evaluations should hold the model, effort, task inputs, and acceptance criteria constant, then compare the number of unnecessary confirmations, tool calls, elapsed time, tokens, AC pass rate, and gate violations before and after the change; do not judge quality solely by the reduction in character count.
