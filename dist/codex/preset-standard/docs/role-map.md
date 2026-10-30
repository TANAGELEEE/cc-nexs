# Role Identity Matrix

cc-nexs selects one of two role sets based on `config.json.mode`:
- **lean mode (default)**: Lean Planner / Lean Plan Reviewer / Lean Developer / Lean Reviewer / Lean Verifier
- **hotfix mode**: Hotfix Developer / Hotfix Reviewer / Hotfix Verifier

## lean mode: low-token role matrix

| Dimension | Lean Planner | Lean Plan Reviewer | Lean Developer | Lean Reviewer | Lean Verifier |
|---|---|---|---|---|---|
| Session | Independent | Independent, no Planner context | Independent per parallel task | Independent full Review / independent delta closure | Independent black-box test |
| Reads | Requirements, source, `docs/solutions/` | Requirements, plan, source, `docs/solutions/` | Approved plan, assigned paths | Approved scope, base...candidate diff, local evidence | Requirements, acceptance matrix, deployed environment |
| Writes | `requirements.md`, `plan.md` approval scope | `plan.md` plan review section | Code/tests within the plan-approved paths | `plan.md` Review section | `plan.md` Test section |
| Forbidden | Code, Git, progress | Requirements, approval scope, code, Git, progress | Approval scope, Git, progress | Code, Git, progress | Source code, Git, progress |
| Model | Configurable per profile | May be a different model, or the same model with higher effort/thinking | Configurable per profile | May be a different model, or the same model with higher effort/thinking | Configurable per profile |

Runtime mapping: Claude Code uses independent Claude subagents; Codex uses an independent native agent; Pi runs each role as an isolated Pi process through `cc_nexs_dispatch`. An explicit high/critical risk can upgrade the Planner before the first dispatch; a high risk discovered during planning upgrades the Plan Reviewer and the subsequent Reviewer without adding a second Planner. Hotfix P0/P1 automatically upgrades the Reviewer; the feature profile ultimately takes precedence.

The plan review happens before Gateway A: the Plan Reviewer checks the plan against the requirements and the code, and blocks only P0/P1 issues. A blocked plan gets one Planner revision and one re-review; findings still open after that go to Gateway A for the human to decide. Gateway A also refuses a plan whose acceptance criteria do not each trace to a task, a local check, and a test check.

Lean's full code Review happens only once: it examines the accumulated diff of all repos, the approval boundary, local evidence, and risks, and lists all P0/P1 at once. After fixes there is at most one delta closure; if blocked again, the case is escalated to a human rather than consuming more tokens. P2/P3 are recorded but do not block.

## Hotfix mini-Lean Roles

- Hotfix Developer: implements the bound scope only in an independent latest-base worktree; does not touch Git/test/base.
- Hotfix Reviewer: isolated from implementation, performs one consolidated Review; at most one delta after fixes.
- Hotfix Verifier: performs black-box repro/regression/smoke on a new environment revision in test; does not read source code.

The Reviewer may use a different model, or the same model with higher effort/thinking; what is mandatory is an independent session. P3, like every other level, runs the Reviewer, local verification, test smoke, and Gateway B; line count does not constitute proof of no behavior change. The BUG path is provided by progress.hotfix_document, and legacy tasks retain hotfix.md; roles must not modify local machine state.

## Boundary violation detection

### prompt layer

Each agent file lists its prohibitions at the top. When a runtime reads the agent, it sees the prohibitions first.

### hooks layer

`hooks/role-boundary-guard.mjs` intercepts at PreToolUse and `hooks/git-custodian-guard.mjs` blocks Git mutations for every role except the Git Custodian. Identity is recognized via the `CC_NEXS_ROLE` environment variable that the orchestrator sets when it dispatches a role (for example `CC_NEXS_ROLE=lean-plan-reviewer`). Pi package-qualified names such as `cc-nexs.lean-reviewer` resolve to the same rules.

### Review layer

The consolidated Reviewer checks that the candidate stays inside the approved plan's paths and scope; a change to approved requirements or contracts in the same candidate is a P0/P1 finding.

## Bypass role: Compound (does not enter the state-machine loop)

`Compound` is a role **outside** the state machine, explicitly triggered by `/cc-nexs:compound <id>`, and does not participate in the INIT → ... → COMPLETE loop.

| Dimension | Compound |
|------|---------|
| **Session** | Independent |
| **Entry command** | `/cc-nexs:compound` (bypass, does not enter the state machine) |
| **agent file** | `agents/compound-claude.md` |
| **Responsibility** | Read a completed requirement and distill "non-obvious lessons" into `docs/solutions/<topic>.md` |
| **Readable** | `requirements.md`, `plan.md`, BUG documents, `progress.json` + existing docs/solutions/*.md |
| **Writable** | docs/solutions/<topic>.md (create or Edit) + all-docs/doc/<id>/compound-summary.md |
| **Must not write** | requirements / plan / src/ / progress / any historical archive under all-docs/doc/<id>/ |

**Strong-signal filter** — a solution may be produced only if any one of the following is met; otherwise write "skipped" in compound-summary.md:
1. The same BUG fixed ≥ 2 times
2. The consolidated Review needed delta closure, or Gateway B requested an implementation change
3. A test verification blocked, or the requirement needed ≥ 3 test attempts
4. A current-state assumption in the plan was overturned
5. A scope change returned the requirement to Gateway A

**Why bypass**: (a) not every requirement has non-obvious lessons, so forcing it produces noise instead; (b) it supports going back over historical requirements (`--force`); (c) the fewer changes to the state machine, the more stable it is.

**Compounding path**: this compound run writes `docs/solutions/<slug>.md` → the Lean Planner and Plan Reviewer grep `docs/solutions/` for the next similar requirement → the plan avoids the pitfall on its first draft.

## Switching identity

It is not a simple "I'm now switching to identity X"; rather, it means **ending the current session and having the orchestrator start a new session**. For example, if the Lean Developer finds that an acceptance criterion conflicts with the code, it stops and reports the conflict; the orchestrator routes the change through a Gateway B scope request, which returns to the Planner, a fresh plan review, and Gateway A.
