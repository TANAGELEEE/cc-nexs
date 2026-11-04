# Review findings

A Review proves defects; it does not argue risks. Only a failure a user would hit, a broken gate, or a candidate/evidence inconsistency blocks. The test environment and the human decide everything else.

## Blocking standard

A finding blocks only when all of these hold:

- severity is P0 or P1;
- it names a concrete failure: this input or state produces this wrong output, crash, data change, or permission result;
- it anchors to an approved acceptance criterion, a cross-client contract, data integrity, a reachable security path inside the candidate, a regression in an existing caller, or an inconsistency between the candidate and its evidence;
- a run demonstrated it: an existing test, a targeted test or script, a request against a locally started service, or another command whose output shows the wrong behavior. Candidate/evidence inconsistency needs no run.

Run repro code outside the candidate worktree (for example under the system temporary directory) and remove it afterwards; never edit candidate files. Do not report a finding you did not run as P0/P1 evidence. Record it with `trace` evidence instead; it does not block, and Gateway B shows it. Style, naming, structure, optional hardening, future generalization, "add more tests", and risks that need a later change to matter are P3 at most. No findings is a valid result.

## Record format

End each Review round with exactly one fenced block in the Review section of the assigned document (Lean `plan.md`, Hotfix BUG document), after the prose summary and before the conclusion line:

````text
```cc-nexs-review
{
  "round": "consolidated",
  "candidate": { "<repo-id>": "<exact candidate commit>" },
  "findings": [
    {
      "id": "F-1",
      "severity": "P1",
      "location": "<repo>/<path>:<line>",
      "anchor": "AC-003",
      "failure_scenario": "<input/state> -> <wrong observable result>",
      "evidence": { "kind": "run", "command": "<exact command>", "observed": "<output that shows the failure>", "expected": "<output the AC or contract requires>" }
    }
  ]
}
```
````

- `round`: `consolidated`, `closure`, or `gateway-b-delta`, matching the Review being recorded.
- `candidate`: every repository commit of the exact candidate the parent injected, nothing else.
- `anchor`: an approved `AC-…` id, `contract`, `data`, `security`, `regression`, or `evidence-mismatch`.
- `evidence.kind`: `run` with `command`, `observed`, and `expected`; or `trace` with `refs` (file:line or evidence ids) for findings no run demonstrated.
- Finding ids are unique within the block; a closure keeps the original ids for findings it rechecks.

The controller reads only the last block. It derives the Review status: any run-proven P0/P1 or `evidence-mismatch` finding blocks, P0/P1 `trace` findings are recorded as unproven, P2/P3 are advisory, and malformed findings are rejected without blocking. The conclusion line must agree with that rule.

## Parent Orchestrator

Before recording, rerun each blocking `run` command against the same candidate. Pass `--not-reproduced <id>` for every finding whose rerun does not show the failure; it is recorded as unproven. Then run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --document-findings [--not-reproduced <finding-id>]... [--closure|--gateway-b-delta]
```

Dispatch the developer with the recorded `blocking_findings` only. When the Review runs before test delivery, inject each unproven P0/P1 `failure_scenario` that a user or API client can observe into the Verifier as a probe check `probe:<finding-id>`. Show unproven, advisory, and rejected counts and unproven summaries at Gateway B.
