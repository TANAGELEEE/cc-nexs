# Role Identity Matrix

cc-nexs selects one of three role sets based on `config.json.mode`:
- **lean mode (default)**: Lean Planner / Lean Developer / Lean Reviewer / Lean Verifier; a single consolidated Review
- **full mode**: five-party heterogeneous roles + current-state reconnaissance (Repo Scout / Planner / Tech Lead / SA / QA / Evaluator)
- **fast mode**: three roles merged (Fullstack / Reviewer / Verifier) — recon is folded into Fullstack's `--phase=spec`; see the end of this document

## lean mode: low-token role matrix

| Dimension | Lean Planner | Lean Developer | Lean Reviewer | Lean Verifier |
|---|---|---|---|---|
| Session | Independent | Independent per parallel task | Independent full Review / independent delta closure | Independent black-box test |
| Writes | `requirements.md`, `plan.md` approval scope | Code/tests within the plan-approved paths | `plan.md` Review section | `plan.md` Test section |
| Forbidden | Code, Git, progress | approval scope, Git, progress | Code, Git, progress | Source code, Git, progress |
| Model | Configurable per profile | Configurable per profile | May be a different model, or the same model with higher effort/thinking | Configurable per profile |

Runtime mapping: Claude Code uses independent Claude subagents; Codex uses an independent native agent; Pi uses the `subagent` from `pi-subagents@0.35.1`. In Fast/Full, multi-repo implementations in the same wave are started once by the parent and then joined, with the whole batch sharing a frozen model routing and explicit worktrees; Pi places siblings in a single asynchronous `tasks` call, sets `worktree: false`, and then joins them via `subagent_wait`. In Lean, an explicit high/critical can upgrade the Planner before the first dispatch; a high risk discovered during planning upgrades the subsequent Reviewer without adding a second Planner, and Hotfix P0/P1 automatically upgrades the Reviewer; the feature profile ultimately takes precedence.

Lean's full Review happens only once: it examines the accumulated diff of all repos, the approval boundary, local evidence, and risks, and lists all P0/P1 at once. After fixes there is at most one delta closure; if blocked again, the case is escalated to a human rather than consuming more tokens. P2/P3 are recorded but do not block.

## full mode: matrix quick reference

| Dimension | Repo Scout | Planner | Tech Lead | SA | QA | Evaluator |
|------|-----------|---------|-----------|----|----|-----------|
| **Tool** | Claude | Claude | Claude | Codex CLI | Claude + chrome-devtools-mcp | Codex CLI |
| **Session** | Independent | Independent | Independent | New invocation each time | New invocation each time | New invocation each time |
| **Entry command** | `/cc-nexs:recon` | `/cc-nexs:planner` | `/cc-nexs:dev` | `/cc-nexs:sa` | `/cc-nexs:qa` | `/cc-nexs:evaluator` |
| **agent file** | `agents/repo-scout-claude.md` | `agents/planner-claude.md` | `agents/tech-lead-claude.md` | `agents/sa-codex.md` | `agents/qa-claude.md` | `agents/evaluator-codex.md` |
| **Responsibilities** | Scan src/ for similar configs/Services/pages → repo-context.md | Business requirements + current-state inventory → spec.md (AC + Sprint slices) | Sprint implementation, integration revisions, post-release fixes, deployment docs | Review spec/test cases/Sprint code/full integration/fix | Black-box final/regression after the full requirement release | Score against all ACs after final QA passes |
| **Can read** | requirements.md, **src/ (read-only)**, cc-nexs.config.yml | requirements.md, **repo-context.md**, spec.md, sa-review.md | spec.md, sa-code-review.md, src/, bugs/, dev-plan.md | spec.md, test-cases.md, code diff | spec.md, api-doc.md, test-cases.md, sa-test-review.md (revisions only) | spec.md, test-report.md, acceptance.md, bugs/ (VERIFIED) |
| **Can write** | repo-context.md | spec.md | src/, dev-plan.md, deploy.md, api-doc.md, bugs/<id>.md | sa-review.md, sa-test-review.md, sa-code-review.md | test-cases.md, test-report.md, bugs/, qa-scripts/ | acceptance.md |
| **Must not read** | spec/sa-*/acceptance/test-* (artifacts of later stages) | **src/**, sa-code-review.md, sa-test-review.md, qa-*, acceptance.md | acceptance.md (may reference, must not depend on), sa-review.md, sa-test-review.md, test-report.md (except the parts it wrote itself) | — | **src/, sa-review.md, sa-code-review.md, dev-plan.md, acceptance.md** | **src/, sa-*.md, dev-plan.md, qa-scripts/** |
| **Must not write** | src/, spec.md, progress.md, any code | src/, progress.md, sa-*.md, acceptance.md, test-* | spec.md, acceptance.md, sa-*.md, test-report.md, progress.md | Code, spec.md, other roles' md | src/, sa-*.md, spec.md | spec.md, sa-*.md, test-report.md, src/ |

## Four golden disciplines

### 0. The Planner must not read src/, but learns the current state indirectly through Repo Scout

The Planner is still **forbidden from reading src/** — this is the foundation of role isolation. But to keep the Planner from designing the spec in a vacuum, **Repo Scout** is introduced as an upfront reconnaissance role:

- Repo Scout may read src/, but **may only** produce `all-docs/doc/<id>/repo-context.md` (a factual inventory); it must not write spec/code/progress.md
- The Planner must read repo-context.md (on the same level as requirements.md)
- What the Planner sees is the condensed factual inventory from Repo Scout, no longer code

Why Repo Scout is needed: previously the Planner designed specs in a vacuum and often ignored existing Services / tables / pages, causing repeated SA rework. Repo Scout moves this step forward to before spec drafting.

### 1. The Planner does not write code; the Tech Lead does not change contracts

Both use Claude, but they are **two independent sessions**. Each session's prompt must explicitly declare its identity at the start.

When a rule break seems necessary:

- The Planner wants to implement something → stop immediately and have the orchestrator switch to a Tech Lead session
- The Tech Lead wants to change spec.md / AC → stop immediately, follow the requirement-change process in §6, and go back to the Planner

### 2. QA is black-box; the Evaluator is even more black-box

| Role | Black-box level |
|------|---------|
| QA | Does not read src/ or sa-review.md / sa-code-review.md. Exception: when writing test cases it may read sa-test-review.md (revisions) |
| Evaluator | One layer stricter than QA. **It does not even read sa-test-review.md**. It looks only at spec + test-report + bugs (VERIFIED) |

Why the Evaluator is stricter: QA runs tests through test cases and inevitably has to fix tests based on SA feedback; the Evaluator is the acceptance authority and must judge from a pure business-contract perspective — any influence from technical review would contaminate it.

### 3. The executor ≠ the acceptor

QA runs the cumulative tests after the full candidate is released to test → test-report.md (execution record)
The Evaluator scores against all contracts after final QA passes → acceptance.md (final acceptance conclusion)

The two **must never** be the same codex invocation. If merged: QA would naturally tend to treat "tested" as "passed," and acceptance would become a formality.

At the implementation level:

- QA declares identity = QA at the start of the `codex` prompt
- The Evaluator declares identity = Evaluator at the start of **a separate `codex`** prompt
- The stdin / stdout of the two invocations are isolated from each other

## Boundary violation detection

### prompt layer

Each agent file lists its prohibitions at the top. When Claude reads the agent, it sees the prohibitions first.

### hooks layer

`hooks/role-boundary-guard.sh` intercepts at PreToolUse. Identity is recognized via environment variables:
```bash
CC_NEXS_ROLE=planner-claude    # Planner session 启动时设置
CC_NEXS_ROLE=tech-lead-claude  # Tech Lead session 启动时设置
# Codex 类无需设置（codex CLI 由命令本体保证身份）
```
The orchestrator's commands declare it explicitly in the prompt and pass it through Bash environment variables when invoking a subagent.

### SA review layer

When SA reviews a code diff, it checks "whether this commit is something the Tech Lead role should be doing" — for example, if a commit changes spec.md and also changes code, that is out of scope, and it is rejected as P0.

## Bypass role: Compound (does not enter the state-machine loop)

`Compound` is a role **outside** the state machine, explicitly triggered by `/cc-nexs:compound <id>`, and does not participate in the INIT → ... → COMPLETE loop.

| Dimension | Compound |
|------|---------|
| **Tool** | Claude |
| **Session** | Independent |
| **Entry command** | `/cc-nexs:compound` (bypass, does not enter the state machine) |
| **agent file** | `agents/compound-claude.md` |
| **Responsibility** | Read all-docs/doc/<id>/* for a completed requirement and distill "non-obvious lessons" into `docs/solutions/<topic>.md` |
| **Readable** | All documents under all-docs/doc/<id>/ (spec / sa-* / bugs / test-report / acceptance / repo-context / progress) + existing docs/solutions/*.md |
| **Writable** | docs/solutions/<topic>.md (create or Edit) + all-docs/doc/<id>/compound-summary.md |
| **Must not write** | spec / src/ / progress / sa-*.md / acceptance / any historical archive under all-docs/doc/<id>/ |

**Strong-signal filter** — a solution may be produced only if any one of the following is met; otherwise write "skipped" in compound-summary.md:
1. The same BUG fixed ≥ 2 times
2. The same kind of SA feedback across ≥ 2 sprints
3. A RECON assumption about the current state is overturned
4. Acceptance fails ≥ 1 time
5. spec.md change log ≥ 3 lines

**Why bypass**: (a) not every requirement has non-obvious lessons, so forcing it produces noise instead; (b) it supports going back over historical requirements (`--force`); (c) the fewer changes to the state machine, the more stable it is.

**Compounding path**: this compound run writes `docs/solutions/<slug>.md` → in the RECON phase of the next requirement, Repo Scout greps and hits it → it is excerpted into repo-context.md `## 7.6 既往教训命中` → the Planner avoids the pitfall on its first draft. This is the literal definition of cc-nexs compounding.

## Switching identity

It is not a simple "I'm now switching to identity X"; rather, it means **ending the current session and having the orchestrator start a new session**.

For example, the Tech Lead discovers while coding that an AC was written incorrectly:
```
[Tech Lead session]
> ⚠️ 发现 AC-003 描述与实现冲突。停手。
> 修复路径：需要 Planner 修订 spec.md。
> 不在本 session 修改 spec.md。
> 退出。

[orchestrator]
> 检测到 SA 评审 NEEDS_REVISION 或 Tech Lead 报 spec 问题
> 状态机推进 → SPEC_REVIEWING
> 起新 Claude session，身份 = Planner
> Planner session 读 sa-review.md（包含 Tech Lead 报告的问题）→ 修订 spec.md
```
## Hotfix mini-Lean Roles

- Hotfix Developer: implements the bound scope only in an independent latest-base worktree; does not touch Git/test/base.
- Hotfix Reviewer: isolated from implementation, performs one consolidated Review; at most one delta after fixes.
- Hotfix Verifier: performs black-box repro/regression/smoke on a new environment revision in test; does not read source code.

The Reviewer may use a different model, or the same model with higher effort/thinking; what is mandatory is an independent session. P3, like every other level, runs the Reviewer, local verification, test smoke, and Gateway B; line count does not constitute proof of no behavior change. The BUG path is provided by progress.hotfix_document, and legacy tasks retain hotfix.md; roles must not modify local machine state.

## Traces of the five parties in progress.md

Each state transition is appended by the orchestrator as one line in the "Historical Trajectory" section:
```
- 2026-05-17T10:23:45 SPEC_DRAFTED → SPEC_REVIEWING  调用 sa-codex
- 2026-05-17T10:25:12 SPEC_REVIEWING → SPEC_PENDING_HUMAN  sa-review.md PASS
- 2026-05-17T11:02:00 SPEC_PENDING_HUMAN → SPEC_APPROVED  人工放行 (example-user)
- 2026-05-17T11:02:30 SPEC_APPROVED → SPRINT_1_KICKOFF
- 2026-05-17T11:15:00 SPRINT_1_KICKOFF → SPRINT_1_DEV  调用 tech-lead-claude
```
This trajectory is the only trustworthy source for post-hoc audit.

---

## fast mode: three-role matrix (0.3.0+)

fast mode merges 5 roles into 3, suited to small changes within a single Sprint. When requirements span multiple ends, Fullstack code workers in different repositories/worktrees run in parallel in the same wave according to the approved ownership; shared documents are still handled by a single owner.

| Dimension | Fullstack | Reviewer | Verifier |
|------|-----------|----------|----------|
| **Tools** | Claude | Codex CLI | Codex CLI |
| **Session** | Independent | New invocation each time | New invocation each time |
| **Entry command** | `/cc-nexs:fullstack` | `/cc-nexs:review` | `/cc-nexs:verify` |
| **agent file** | `agents/fullstack-claude.md` | `agents/reviewer-codex.md` | `agents/verifier-codex.md` |
| **Merged from** | Planner + Tech Lead | SA code review + Evaluator contract scoring | QA cases + run + regression |
| **Responsibilities** | spec.md + code + deployment docs + bug fixes | Independent target review of spec / code before each release round / final contract | Write/run test cases after test release + regression on new deployment |
| **Can read** | requirements / spec / sa-review / sa-code-review / src/ / bugs/ | spec / test-report / bugs(VERIFIED) / diff for the current round | spec / api-doc / deploy / bugs/ |
| **Can write** | spec / src/ / dev-plan / api-doc / deploy / bugs/<id> | sa-review / sa-code-review / acceptance | test-cases / test-report / bugs/ / qa-scripts/ |
| **Must not read** | (none enforced) | **src/** / dev-plan.md / sa-test-review.md | **src/** / sa-review.md / sa-code-review.md / sa-test-review.md / dev-plan.md |
| **Must not write** | progress / acceptance / sa-*.md / test-report | spec / src/ / md files of other roles | src/ / sa-*.md / spec.md / acceptance.md |

### Three minimum disciplines (still retained in fast)

1. **Spec before code**: Fullstack must first complete the spec and the ownership table. During implementation, workers in multiple repositories run independently in parallel, and modifying the approved scope is forbidden; if AC/ownership must change midway, you must return to G1.
2. **Executor ≠ acceptor**: Verifier runs tests vs Reviewer accepts → two independent codex invocations that do not read each other's artifacts.
3. **Black box above all**: Verifier does not read src/ or sa-*.md; signing goes through api-doc.md; Reviewer reviews code based on the diff and does not browse the source directory.

### Key trade-offs vs full

| full safeguard | fast status |
|---|---|
| Planner does not write code / Tech Lead does not modify spec | ❌ Merged into Fullstack (accepts same-session risk)|
| SA reviews test cases (sa-test-review.md) | ❌ Skipped (fast does not review the test cases themselves)|
| Strict role isolation between Evaluator and SA | ⚠️ Merged into the Reviewer identity, but code/accept must be two independent target/session runs and cannot be produced in the same run |
| Sprint slicing to prevent large changes | ❌ Forced single-sprint M1 |
| Circuit breaker after 3 re-reviews | ⚠️ Tightened to 2 (escalates to the decision layer earlier)|

## hooks adaptation

`hooks/role-boundary-guard.mjs` recognizes both full + fast role names (`fullstack` / `reviewer` / `verifier`). The orchestrator sets environment variables when invoking subagents:
```bash
CC_NEXS_ROLE=fullstack    # fast Fullstack
CC_NEXS_ROLE=reviewer     # fast Reviewer
CC_NEXS_ROLE=verifier     # fast Verifier
```

Pi API compatibility: `cc_nexs_dispatch` adapts the wave above to legacy tasks or Tintin RPC v2 with assigned cwd. Tintin uses completion notifications and `get_subagent_result` instead of `subagent_wait`; the all-sibling barrier and role ownership remain unchanged.
