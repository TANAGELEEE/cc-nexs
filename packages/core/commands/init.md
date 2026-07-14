---
description: Initialize progress.json v2 and create one isolated worktree per configured repository through Git Custodian.
allowed-tools: Read, Write, Edit, Bash, Skill
argument-hint: [feature_id] <feature_slug> [--mode=full|fast] [--repos=a,b] [--sprints=N]
---

# /cc-nexs:init

Bootstrap a feature directory under `all-docs/doc/`. By default creates an isolated git worktree at `.worktrees/<id>-<slug>/` so multiple features can be developed in parallel.

## Args

- `feature_id` — optional; when omitted, call `nextFeatureId()` so merged docs, active worktrees, and durable reservations all participate in allocation
- `feature_slug` — required
- `--mode=full|fast` — pipeline mode (default `fast`). Pass `--mode=full` explicitly for the multi-role sprint flow.
- `--sprints=N` — optional sprint count (planner can decide later in full mode; ignored in fast mode)
- `--repos=a,b` — optional code repositories to isolate immediately; docs repository is always included

## Steps

1. Validate args. Parse `--mode` (default `fast`); reject anything other than `full|fast`.
2. Load `.cc-nexs/workspace.yml` and call `publishDocsReservation()` before creating any feature worktree. It fetches the docs repository's remote base, allocates against the remote tree, creates `doc/<id>.<slug>/{README.md,.cc-nexs-reservation.json}` in a detached temporary worktree, commits, and fast-forward pushes that commit directly to the docs base. The returned id is authoritative. Concurrent push rejection causes an automatic refetch/reallocation retry for auto ids. A retry after partial init resumes the locally recorded remote reservation for the same slug. Explicit duplicate ids fail. If direct push is protected or denied, stop before code worktrees are created; do not pretend a local reservation is globally visible.
3. Call `createWorkspaceWorktrees()` after the remote docs reservation succeeds. It fetches each configured `origin/<base_branch>` and creates an untracked-upstream feature branch from that exact remote commit using `git worktree add --no-track`; therefore the docs feature branch already contains the phase-one reservation. It must never use the caller's checked-out HEAD. Abort and roll back newly created worktrees if isolation fails, but retain the published docs reservation so the same id can be resumed safely.
4. Resolve preset templates dir from `${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT}}}}/templates/`.
5. Copy all template files to the already reserved `${DOC_WORKTREE}/doc/<id>.<slug>/`; replace the phase-one README with the normal template and retain `.cc-nexs-reservation.json` as allocation evidence:
   ```bash
   CC_NEXS_RESOLVED_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT:-}}}}"
   [ -n "$CC_NEXS_RESOLVED_PLUGIN_ROOT" ] || { echo "❌ 找不到 plugin root（需 CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / CODEX_PLUGIN_ROOT / CC_NEXS_PLUGIN_ROOT）"; exit 1; }
   REQ_DIR="${DOC_WORKTREE}/doc/${feature_id}.${feature_slug}"
   mkdir -p "$REQ_DIR"
   cp -r "${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates/"* "${REQ_DIR}/"
   ```
6. Edit progress.md (in `$REQ_DIR`):
   - Replace `{编号}` / `{id}` placeholders with feature_id
   - Replace `{需求短名}` / `{slug}` with feature_slug
   - Set `feature_id`, `feature_slug`, `preset` (read from preset.yml)
7. Write `mode` into both `${REQ_DIR}/config.json` and authoritative `${REQ_DIR}/progress.json`. The template and missing-value fallback both default to `fast`; set `sprint.enabled=true` only for full mode:
   ```bash
   # BSD/macOS sed: use [[:space:]] (not \s)
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}/config.json"
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}/progress.json"
   ```
8. Record every repository branch/worktree assignment in progress.json and append a `workspace.worktrees_created` event. Roles may not create or switch branches.
   Record the returned `baseBranch` and `baseCommit` in the initialization event for audit output. The feature branch intentionally has no upstream until an explicit publish action sets `origin/feature/...`; therefore IDEs must not show misleading pull/push divergence against `origin/master` or `origin/test`.
8.5. **Seed the per-feature README** so the user sees fresh state on first `cd`. Best-effort:
   ```js
   import { syncFeatureReadme } from '@cc-nexs/core/lib/readme-sync.mjs';
   try {
     const r = syncFeatureReadme({ reqDir: REQ_DIR });
     // INIT state seeds requirements 🟢 (after PM fills it) / others ⚪ / current_state INIT
     // 'no_readme' = preset has no README template (minimal); silently skip.
     // 'no_anchor' = template lacks markers; skip with warning (template bug, surface it).
   } catch (e) {
     console.warn(`⚠️ README seed failed: ${e.message} (non-fatal)`);
   }
   ```
9. Print:
   ```
   ✅ Initialized all-docs/doc/<id>.<slug>/
      Mode:     <full | fast>
      Templates copied: <N> files
      Branch:   feature/<id>-<slug>
      Worktree: <WORK_DIR>          ← absolute path; .worktrees/<id>-<slug>/ when default mode

   👉 Next:
      1. Stay at the workspace root; the Orchestrator dispatches each role to its assigned repository worktree
      2. Edit all-docs/doc/<id>.<slug>/requirements.md (business needs)
      3. Run /cc-nexs:run <id> to start the pipeline
   ```
