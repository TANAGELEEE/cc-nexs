---
description: "Create or refresh a code repository's verification guide and feature map, in the repository, in the docs repository (--docs), or in the workspace (--workspace), so every Verifier drives the real app the same way. Bypass command; does not enter the state machine."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Bash"
argument-hint: "<repository-id> [--docs|--workspace] [--refresh]"
---

> The user invoked this command and its instructions are loaded below: follow them now. Do not call the Skill tool for it.

# /cc-nexs:verify-skill

Verification is the main gate, so each code repository needs a scripted, repeatable way to drive the real app and prove behavior. This command writes that as plain Markdown inside the repository, readable by Claude Code, Codex, and Pi alike:

```text
<repo>/.cc-nexs/verify/README.md        how to launch, check, drive, prove, and clean up
<repo>/.cc-nexs/verify/features/README.md   index of user-facing features
<repo>/.cc-nexs/verify/features/<feature>.md   one file per feature
```

Choose where the guide lives; the layout below the chosen directory is the same (`README.md` and `features/`):

| Option | Location | Versioned | Read by Verifiers from |
|---|---|---|---|
| (default) | `<repo>/.cc-nexs/verify/` | with the code | the exact candidate commit |
| `--docs` | `<docs-repo>/.cc-nexs/verify/<repository-id>/` (the workspace `docs_repository`) | in the docs repository | its committed base branch (`origin/<base>`, else `<base>`) |
| `--workspace` | `<workspace>/.cc-nexs/verify/<repository-id>/` | no, local only | the workspace directory |

`verify-guides` uses the first guide it finds in that order: candidate commit, docs repository, workspace. Use `--docs` when the team keeps these files out of the code repository but wants them shared and versioned; `--workspace` for a single machine. A docs or workspace guide is not bound to the candidate commit, so refresh it when a change alters how the app starts or is driven.

Resolve `<repository-id>` from the workspace configuration and read that repository's main checkout. The reader is a Verifier that has never seen the app, reading cold in the middle of a task: write exact commands and stable handles, not examples or placeholders.

The Verifier drives the app with its runtime's own agent browser (`cc-nexs browser-provider --runtime <claude|codex|pi>`: ego lite, `chrome-devtools-mcp`, or the Codex in-app/Chrome session) and judges what it sees, so it catches visual and interaction defects a script would miss. Write journeys as steps a person or agent follows in any of those browsers. Ship a script only for the Doctor and for API probes that need exact request/response proof; never one script per feature or journey, and do not generate test suites. The repository's own test suites stay local checks, not the Verifier's method.

Two rules hold for every file this command writes:

- **No secrets.** Never write a password, token, cookie, API key, or private credential value. Name the environment variable, secret store entry, or login step that supplies it. Before handing over, search the written files for credential-like values and account identities, check that no script reads a credential source or puts a credential on a command line, and fix what you find.
- **Accounts only through `cc-nexs test-account`.** A script that signs in reads the account only from `CC_NEXS_TEST_USER` and `CC_NEXS_TEST_PASSWORD`, and the guide runs it as `cc-nexs test-account -- <script>`; no script reads a credential file, keychain, or other variable itself. Never put a credential, or a value derived from it such as a password hash or token, on a command line (it shows in the process list): pass request bodies through stdin (for example `curl --data @-`) or a file under the evidence directory that cleanup removes. Describe the account a journey needs by its properties (role, plan, credits, data), not by its identity (no email, user id, or display name).
- **Evidence stays outside the repository.** Screenshots, response bodies, logs, and other proof go under the system temporary directory (or another path outside every repository); the guide names that location pattern. Proof can contain real or test data and is never committed.

## 1. Learn the repository, not the user

Answer these from the code, its scripts, and its docs; ask the user only what cannot be observed:

- **Surface**: what a user or client touches (web UI, API, CLI, worker). Pick the primary one and note the rest.
- **Environments**: how it starts locally (the repository's own dev command, ports, env vars, seed data), and how the deployed test environment is reached (base URLs and hosts from the workspace `release.test` configuration; never credentials).
- **Sign-in**: how a user signs in, and what proves a session is signed in. Verifiers reuse a session the browser already holds; otherwise they use the workspace `release.test.credential_ref` through `cc-nexs test-account`. Record which account properties a journey needs (role, plan, credits, data) as preconditions, never the account itself.
- **Drive**: the user path through the UI with stable handles; for services, the HTTP requests; for CLIs, the commands.
- **Observe**: what proves behavior (screenshots, response bodies, logs, exit codes, rows written, messages sent).
- **Isolate**: whether two instances can run side by side. If not, say so; refusing to double-drive a shared instance beats corrupting someone's session.

If the checkout does not start as-is, fix the start-up only when the fix is local scaffolding (mark it as verification scaffolding and remove it in cleanup); otherwise report the blocker precisely and stop.

## 2. Write the guide

`README.md` has these sections, each grounded in what step 1 found:

- **Launch**: the exact local start command and how to tell it is usable (not merely that a port answers), from an empty data directory including migrations and seed data; and how to target the deployed test environment instead.
- **Doctor**: one read-only check that answers "is this instance worth driving?" (process up, expected revision, port owned by this run, auth valid). A Verifier runs it first, and again whenever something looks off.
- **Sign-in**: how to tell the browser is already signed in on the test host, the login page and its handles, and that the Verifier signs in with `cc-nexs test-account -- <command>` when no session exists (the command reads `CC_NEXS_TEST_USER`/`CC_NEXS_TEST_PASSWORD`; nothing is typed or printed). If neither works, the Verifier asks the human to sign in.
- **Drive**: the journeys as numbered steps with real routes, stable handles (ARIA labels, roles, data attributes, ids), and the visible state after each important step. Prefer handles over coordinates. Name the API calls a step triggers when they prove the result.
- **Evidence**: what to capture for a proof, where it goes (outside the repository), and the standard it must meet: the real user path, not internal setters or test-only endpoints; a screenshot of each journey's end state, checked for broken layout, error, empty, or loading states, and console errors; the backing API response; side effects (rows, files, messages) alongside what is visible; mocks only where a production boundary already isolates the external system.
- **Cleanup**: how to stop what the run started. Kill only what you started, never by process name. Cleanup keeps the evidence.
- **Helpers**: the Doctor script and any API probe, executable, with the invocation shown (through `cc-nexs test-account --` when it signs in). No journey scripts.

## 3. Seed the feature map

Write `features/README.md` as an index and one file per user-facing feature, starting with the three to five most used (from routes, menus, commands, or docs). Each feature file answers, from the user's point of view: what it is and its sub-features, the account preconditions it needs, how to reach it, the journey as numbered browser steps, the observable end state (what the page shows and what must not appear) that proves it works, and gotchas. If seed data lacks a precondition a journey needs, the journey reports that failure and the reason goes under gotchas; never weaken the journey to make it pass.

## 4. Prove it before handing it over

Run the guide end to end once with your own agent browser: launch (or target test), doctor, sign in, drive one mapped feature, capture evidence, clean up, then confirm the evidence still exists. Fix what fails and clean up after every failed attempt. A guide that was never executed is a draft. If you proved it somewhere other than its real target, list the steps that target still needs.

## `--refresh`

Audit an existing guide (at the location the same option selects) against the current code: read each feature file against the code it describes, then make one live pass that drives every mapped feature. Convert any journey script the guide ships into written steps and remove the script, and bring the remaining scripts under the account rules above. Change only the guide's own files. End with exactly one outcome: `clean` (full coverage, nothing changed), `changed` (the corrections made), or `blocked` (the blocker). A product defect the live pass finds is reported, never fixed here.

## Handing over

Do not commit, branch, or push. List the files written, the proof from step 4, and the result of the secret search. Confirm the code repository's `git status` shows no files from this run other than `.cc-nexs/verify/` (none at all with `--docs` or `--workspace`). For a repository guide, tell the user to merge `.cc-nexs/verify/` into the base branch: feature worktrees are created from the base, and Verifiers read the guide from the exact candidate commit. For a docs guide, tell the user to commit `.cc-nexs/verify/<repository-id>/` to the docs repository's base branch and push it; uncommitted docs guides are not used. A workspace guide needs no merge. `node <plugin-root>/lib/cc-nexs-cli.mjs verify-guides <id>` shows which guide each candidate repository uses.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
