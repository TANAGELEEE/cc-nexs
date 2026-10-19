---
description: "Initialize progress.json v2 and create one isolated worktree per configured repository through Git Custodian."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Skill"
argument-hint: "[feature_id] <feature_slug> [--mode=lean|hotfix|fast|full] [--repos=a,b] [--sprints=N]"
---

# /cc-nexs:init

Bootstrap a feature directory under `all-docs/doc/`. By default creates an isolated git worktree at `.worktrees/<id>-<slug>/` so multiple features can be developed in parallel.

## Args

- `feature_id` — optional; when omitted, call `nextFeatureId()` so merged docs, active worktrees, and durable reservations all participate in allocation
- `feature_slug` — required
- `--mode=lean|hotfix|fast|full` — pipeline mode. New features default to `lean`; `hotfix` immediately routes to `init-hotfix`: a repair branch and BUG document with no shared feature reservation.
- `--sprints=N` — optional sprint count (planner can decide later in full mode; ignored in fast mode)
- `--repos=a,b` — optional code repositories to isolate immediately; docs repository is always included

## Steps

1. Validate args. Parse `--mode` using CLI > `workflow.default_mode` > `lean`; reject anything other than `lean|hotfix|fast|full`. Missing mode on an existing progress file still means `fast` for backward compatibility. For `hotfix`, require a preset with Hotfix templates/roles, then call `cc-nexs-cli.mjs init-hotfix <slug> --description "<description>" [--repos a,b]`, return its BUG document and `.cc-nexs/hotfixes/<key>/` state paths, and stop this initialization path. Do not run the reservation/template/brainstorm steps below. Existing Hotfix tasks resume with `hotfix <key-or-id>`.
2. For Lean/Fast/Full only, load `.cc-nexs/workspace.yml` and call `publishDocsReservation()` before creating any feature worktree. It fetches the docs repository's remote base, allocates against the remote tree, creates `doc/<id>.<slug>/{README.md,.cc-nexs-reservation.json}` in a detached temporary worktree, commits, and fast-forward pushes that commit directly to the docs base. The returned id is authoritative. Concurrent push rejection causes an automatic refetch/reallocation retry for auto ids. A retry after partial init resumes the locally recorded remote reservation for the same slug. Explicit duplicate ids fail. If direct push is protected or denied, stop before code worktrees are created; do not pretend a local reservation is globally visible.
3. Call `createWorkspaceWorktrees()` after the remote docs reservation succeeds. It fetches each configured `origin/<base_branch>` and creates an untracked-upstream feature branch from that exact remote commit using `git worktree add --no-track`; therefore the docs feature branch already contains the phase-one reservation. It must never use the caller's checked-out HEAD. Abort and roll back newly created worktrees if isolation fails, but retain the published docs reservation so the same id can be resumed safely.
4. Resolve preset templates dir from `${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT}}}}/templates/`.
5. Copy templates to the reserved feature directory. Lean copies `templates/lean/*` and removes the reservation README. Fast/full keep the existing complete template set. `.cc-nexs-reservation.json` is always retained:
   ```bash
   CC_NEXS_RESOLVED_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-${CC_NEXS_PLUGIN_ROOT:-}}}}"
   [ -n "$CC_NEXS_RESOLVED_PLUGIN_ROOT" ] || { echo "❌ 找不到 plugin root（需 CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / CODEX_PLUGIN_ROOT / CC_NEXS_PLUGIN_ROOT）"; exit 1; }
   REQ_DIR="${DOC_WORKTREE}/doc/${feature_id}.${feature_slug}"
   TEMPLATE_ROOT="${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates"
   CC_NEXS_LOCALE="${CC_NEXS_LOCALE:-en-US}"
   LOCALE_TEMPLATE_ROOT=""
   if [ -n "${CC_NEXS_LOCALE:-}" ] && [ -d "${TEMPLATE_ROOT}/${CC_NEXS_LOCALE}" ]; then LOCALE_TEMPLATE_ROOT="${TEMPLATE_ROOT}/${CC_NEXS_LOCALE}"; fi
   mkdir -p "$REQ_DIR"
   if [ "$MODE" = "lean" ]; then
     cp -r "${TEMPLATE_ROOT}/${MODE}/"* "${REQ_DIR}/"
     [ -d "${LOCALE_TEMPLATE_ROOT}/${MODE}" ] && cp -r "${LOCALE_TEMPLATE_ROOT}/${MODE}/"* "${REQ_DIR}/"
     rm -f "${REQ_DIR}/README.md"
   else
     find "${TEMPLATE_ROOT}" -mindepth 1 -maxdepth 1 ! -name lean ! -name hotfix ! -name en-US ! -name zh-TW -exec cp -R {} "${REQ_DIR}/" \;
     if [ -d "$LOCALE_TEMPLATE_ROOT" ]; then find "$LOCALE_TEMPLATE_ROOT" -mindepth 1 -maxdepth 1 ! -name lean ! -name hotfix ! -name en-US ! -name zh-TW -exec cp -R {} "${REQ_DIR}/" \; fi
   fi
   ```
6. Edit progress.md (in `$REQ_DIR`):
   - Replace `{编号}` / `{id}` placeholders with feature_id
   - Replace `{需求短名}` / `{slug}` with feature_slug
   - Set `feature_id`, `feature_slug`, `preset` (read from preset.yml)
7. Write `mode` into both `${REQ_DIR}/config.json` and authoritative `${REQ_DIR}/progress.json`. New templates default to `lean`; set `sprint.enabled=true` only for full mode:
   ```bash
   # BSD/macOS sed: use [[:space:]] (not \s)
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}/config.json"
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}/progress.json"
   ```
8. Record every repository branch/worktree assignment in progress.json and append a `workspace.worktrees_created` event. Roles may not create or switch branches.
   Record the returned `baseBranch` and `baseCommit` in the initialization event for audit output. The feature branch intentionally has no upstream until an explicit publish action sets `origin/feature/...`; therefore IDEs must not show misleading pull/push divergence against `origin/master` or `origin/test`.
8.5. For fast/full, seed the per-feature README. Lean has no README; skip this step.
   ```js
   import { syncFeatureReadme } from 'lib/readme-sync.mjs';
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
      Mode:     <lean | fast | full>
      Templates copied: <N> files
      Branch:   feature/<id>-<slug>
      Worktree: <WORK_DIR>          ← absolute path; .worktrees/<id>-<slug>/ when default mode

   👉 Next:
      1. Stay at the workspace root; the Orchestrator dispatches each role to its assigned repository worktree
      2. Lean edits requirements.md
      3. Lean: /cc-nexs:plan <id>; fast/full: /cc-nexs:run <id>
   ```

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
