# Review findings

A Review proves defects; it does not argue risks. Only a failure a user would hit, a broken gate, or a candidate/evidence inconsistency blocks. The test environment and the human decide everything else.

## Roles in one Review round

- **Reviewers** are the members of `review.panel`. Every reviewer gets the same brief, scope, and exact candidate: break this change, and prove each finding with a run against the real code. There are no assigned lenses; a reviewer covers acceptance criteria, logic, callers, contracts and data, error and recovery paths, and security reachable through the candidate. Reviewers run independently, in parallel, and write nothing to the candidate.
- **The Judge** is one fresh session that did not review. It reruns every P0/P1 `run` command, keeps every verified finding from any reviewer (not one reviewer's list, and no voting), merges findings that share a root cause into one with every reviewer in `found_by`, sets a verdict on each P0/P1, and writes the single `cc-nexs-review` block plus the human summary and conclusion line into the assigned document (Lean `plan.md`, Hotfix BUG document).

The panel is configuration, not risk routing. One entry means one reviewer, several mean several, and with no `review.panel` the round has one native reviewer on the Reviewer role's routing:

```yaml
review:
  panel:
    - id: r1                  # native: a subagent of the host runtime
      profile: review         #   model from a model profile, or `model:` (+ `effort:`)
    - id: gpt
      executor: codex-cli     # codex-cli | claude-cli | agy-cli | dsh-cli | pi-cli
      model: <model id>       #   passed to the CLI; omit for the CLI's default
      effort: high
  skills:                     # optional: files every reviewer reads first
    - .cc-nexs/review-skills/api-contracts
```

The list applies to every runtime. To give each runtime its own reviewers, key the panel by runtime; a runtime without a list gets the default single native reviewer:

```yaml
review:
  panel:
    claude: [{ id: claude }, { id: gpt, executor: codex-cli, model: <model id> }]
    codex: [{ id: gpt }, { id: gemini, executor: agy-cli, model: <model id> }]
    pi: [{ id: pi, profile: review }, { id: deepseek, model: <model id> }]
```

`review-panel`, `run-reviewer`, `record-reviewer`, and `record-review` pick the list for the runtime they run in (`--runtime` overrides it for `review-panel`), and a stored result only counts for the runtime that produced it.

A CLI reviewer runs another agent CLI non-interactively in the workspace, so a Claude Code or Codex host can include another vendor's model. `dsh-cli` uses the signed-in account and takes `provider`/`model` (or `provider/model`) and an optional `dsh_profile` (default `headless`). Every CLI reviewer uses the credentials that CLI is already signed in with; cc-nexs passes none. `timeout_seconds` (default 1800) bounds a CLI reviewer.

Skills steer what reviewers emphasize. Each entry is a skill directory (its `SKILL.md`) or a Markdown file, relative to the workspace.

A closure or Gateway B delta uses one reviewer, the first panel member, which reruns the original findings and checks only regressions the fix introduced; it does not open new discovery.

## Blocking standard

A finding blocks only when all of these hold:

- severity is P0 or P1;
- it names a concrete failure: this input or state produces this wrong output, crash, data change, or permission result;
- it anchors to an approved acceptance criterion, a cross-client contract, data integrity, a reachable security path inside the candidate, a regression in an existing caller, or an inconsistency between the candidate and its evidence;
- a run demonstrated it: an existing test, a targeted test or script, a request against a locally started service, or another command whose output shows the wrong behavior;
- the Judge reran that command against the same candidate and confirmed the failure.

A candidate/evidence inconsistency needs no run; it blocks unless the Judge refutes it. Run repro code outside the candidate worktree (for example under the system temporary directory) and remove it afterwards; never edit candidate files. Report a suspected failure you could not run with `trace` evidence; it does not block, and Gateway B shows it. Style, naming, structure, optional hardening, future generalization, "add more tests", and risks that need a later change to matter are P3 at most. No findings is a valid result.

## Record format

The Judge ends the Review section with exactly one fenced block, after the prose summary and before the conclusion line:

````text
```cc-nexs-review
{
  "round": "consolidated",
  "candidate": { "<repo-id>": "<exact candidate commit>" },
  "reviewers": [
    { "id": "r1", "executor": "native", "model": "<model the reviewer ran on>" },
    { "id": "gpt", "executor": "codex-cli", "model": "<model the CLI reported>" }
  ],
  "findings": [
    {
      "id": "F-1",
      "severity": "P1",
      "location": "<repo>/<path>:<line>",
      "anchor": "AC-003",
      "failure_scenario": "<input/state> -> <wrong observable result>",
      "evidence": { "kind": "run", "command": "<exact command>", "observed": "<output that shows the failure>", "expected": "<output the AC or contract requires>" },
      "found_by": ["r1", "gpt"],
      "judge": { "verdict": "confirmed", "rerun": "<output of the Judge's rerun>" }
    }
  ]
}
```
````

- `round`: `consolidated`, `closure`, or `gateway-b-delta`, matching the Review being recorded.
- `candidate`: every repository commit of the exact candidate the parent injected, nothing else.
- `reviewers`: every reviewer of this round with its executor and the model it ran on, exactly as `review-panel` reports their stored results; a consolidated round lists the whole panel, a closure or delta lists its one reviewer.
- `found_by`: the reviewer ids that reported the finding; a finding several reviewers reported independently lists all of them.
- `anchor`: an approved `AC-…` id, `contract`, `data`, `security`, `regression`, or `evidence-mismatch`.
- `evidence.kind`: `run` with `command`, `observed`, and `expected`; or `trace` with `refs` (file:line or evidence ids) for findings no run demonstrated.
- `judge.verdict`: `confirmed` (the rerun shows the failure), `refuted` (the rerun shows correct behavior, or the claim is false), or `plausible` (the rerun is inconclusive). Set it on every P0/P1 finding.
- Finding ids are unique within the block; a closure keeps the original ids for findings it rechecks.

The controller reads only the last block, checks the candidate, checks that the reviewers match `review.panel` and that each one stored its own result for this round and candidate on the model listed, and derives the Review status: confirmed run-proven P0/P1 and unrefuted `evidence-mismatch` findings block; other P0/P1 findings are unproven or refuted; P2/P3 are advisory; malformed findings are rejected without blocking. The conclusion line must agree with that rule.

## Parent Orchestrator

1. Run `node <plugin-root>/lib/cc-nexs-cli.mjs review-panel <id> --runtime <claude|codex|pi> [--round closure|gateway-b-delta]`. It lists the round's reviewers with their executor and model, the role and rules files, the skills, and the brief file path.
2. Write the brief file: the Review inputs and exact candidate commits, the paths of the role file, `rules/review-findings.md`, and every skill to read first, and the instruction to reply with only `{"findings": [...]}`. Every reviewer gets this same brief.
3. Start every reviewer in parallel:
   - native: dispatch the Reviewer role as an independent subagent on the model `review-panel` lists (role routing when it says so) with the brief, then save its reply to a file and run `record-reviewer <id> --reviewer <rid> --model <model it ran on> --findings-file <file> [--round ...]`;
   - CLI: `node <plugin-root>/lib/cc-nexs-cli.mjs run-reviewer <id> --reviewer <rid> --brief <brief file> [--round ...]`. It stores the findings and the model the CLI reports, and discards the result if the reviewer changed a candidate worktree.
4. Dispatch one Judge (a fresh Reviewer-role session) with the same inputs and every stored reviewer result. The Judge writes the document.
5. Record the round:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --document-findings [--closure|--gateway-b-delta]
```

`--not-reproduced <finding-id>` remains available when the Orchestrator itself observes that a confirmed failure does not reproduce. Dispatch the developer with the recorded `blocking_findings` only. When the Review runs before test delivery, inject each unproven P0/P1 `failure_scenario` that a user or API client can observe into the Verifier as a probe check `probe:<finding-id>`. Show unproven, refuted, advisory, and rejected counts and unproven summaries at Gateway B.
