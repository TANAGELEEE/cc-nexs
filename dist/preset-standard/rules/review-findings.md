# Review findings

A Review proves defects; it does not argue risks. Only a failure a user would hit, a broken gate, or a candidate/evidence inconsistency blocks. The test environment and the human decide everything else.

## Roles in one Review round

- **Finders** search the exact candidate in parallel, each in a fresh session through one lens, and return their findings as JSON in their final message. They write nothing.
- **The Judge** is one fresh session that did not find anything. It reruns every P0/P1 `run` command, merges findings that share a root cause, sets a verdict on each P0/P1, and writes the single `cc-nexs-review` block plus the human summary and conclusion line into the assigned document (Lean `plan.md`, Hotfix BUG document).

Finders and the Judge are the same Reviewer role (`lean-reviewer` or `hotfix-reviewer`) with a different assignment, so they use the Reviewer's model routing.

| Risk tier (Lean plan, or Hotfix severity P3/P2 → low/medium, P1 → high, P0 → critical) | Finder lenses for a consolidated Review |
|---|---|
| low | one Finder: `correctness` (covering every lens briefly) |
| medium | `correctness`, `contracts-data` |
| high, critical | `correctness`, `contracts-data`, `security` |

A closure or Gateway B delta uses one `delta` Finder that reruns the original findings and checks only regressions the fix introduced; it does not open new discovery.

Lenses:

- `correctness`: acceptance criteria, logic, existing callers and regressions.
- `contracts-data`: frontend/backend/API contracts and DTOs, persistence, transactions, concurrency, error and recovery paths, deployment and rollback.
- `security`: permissions, authentication, secrets, and injection reachable through the candidate.

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
  "finders": ["correctness", "contracts-data"],
  "findings": [
    {
      "id": "F-1",
      "severity": "P1",
      "location": "<repo>/<path>:<line>",
      "anchor": "AC-003",
      "failure_scenario": "<input/state> -> <wrong observable result>",
      "evidence": { "kind": "run", "command": "<exact command>", "observed": "<output that shows the failure>", "expected": "<output the AC or contract requires>" },
      "found_by": ["correctness"],
      "judge": { "verdict": "confirmed", "rerun": "<output of the Judge's rerun>" }
    }
  ]
}
```
````

- `round`: `consolidated`, `closure`, or `gateway-b-delta`, matching the Review being recorded.
- `candidate`: every repository commit of the exact candidate the parent injected, nothing else.
- `finders`: the lenses that actually ran this round.
- `anchor`: an approved `AC-…` id, `contract`, `data`, `security`, `regression`, or `evidence-mismatch`.
- `evidence.kind`: `run` with `command`, `observed`, and `expected`; or `trace` with `refs` (file:line or evidence ids) for findings no run demonstrated.
- `judge.verdict`: `confirmed` (the rerun shows the failure), `refuted` (the rerun shows correct behavior, or the claim is false), or `plausible` (the rerun is inconclusive). Set it on every P0/P1 finding.
- Finding ids are unique within the block; a closure keeps the original ids for findings it rechecks.

The controller reads only the last block, checks the candidate and the finder lenses the risk tier requires, and derives the Review status: confirmed run-proven P0/P1 and unrefuted `evidence-mismatch` findings block; other P0/P1 findings are unproven or refuted; P2/P3 are advisory; malformed findings are rejected without blocking. The conclusion line must agree with that rule.

## Parent Orchestrator

1. Dispatch the Finders for the bound risk tier in parallel, each with the Review inputs, the exact candidate commits, and its lens.
2. Dispatch one Judge with the same inputs and every Finder's returned findings. The Judge writes the document.
3. Record the round:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --document-findings [--closure|--gateway-b-delta]
```

`--not-reproduced <finding-id>` remains available when the Orchestrator itself observes that a confirmed failure does not reproduce. Dispatch the developer with the recorded `blocking_findings` only. When the Review runs before test delivery, inject each unproven P0/P1 `failure_scenario` that a user or API client can observe into the Verifier as a probe check `probe:<finding-id>`. Show unproven, refuted, advisory, and rejected counts and unproven summaries at Gateway B.
