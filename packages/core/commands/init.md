---
description: Initialize a new feature directory by copying preset templates and creating progress.md. Defaults to creating a git worktree under .worktrees/<id>-<slug>/ for parallel feature development.
allowed-tools: Read, Write, Edit, Bash, Skill
argument-hint: <feature_id> <feature_slug> [--mode=full|fast] [--sprints=N] [--no-worktree]
---

# /cc-nexs:init

Bootstrap a feature directory under `all-docs/doc/`. By default creates an isolated git worktree at `.worktrees/<id>-<slug>/` so multiple features can be developed in parallel.

## Args

- `feature_id` — required
- `feature_slug` — required
- `--mode=full|fast` — pipeline mode (default `full`). `fast` enables 3-role merged single-sprint flow.
- `--sprints=N` — optional sprint count (planner can decide later in full mode; ignored in fast mode)
- `--no-worktree` — opt out of worktree creation; fall back to `git checkout -b` in the current directory

## Steps

1. Validate args. Parse `--mode` (default `full`); reject anything other than `full|fast`. Parse `--no-worktree` (default off → worktree created).
2. Pre-check `doc/<feature_id>.<feature_slug>/` in the **main repo**. If it already exists, refuse and print existing progress.md state.
3. **Create worktree (default)**:
   - Unless `--no-worktree`, invoke the `using-worktrees` skill with args `<feature_id> <feature_slug>`.
   - The skill creates `.worktrees/<id>-<slug>/`, ensures `.gitignore` covers it, creates branch `feature/<id>-<slug>`, and reports `WORKTREE_PATH` / `BRANCH` / `STATUS`.
   - On `STATUS=refused_nested` (already inside a worktree): abort and tell the user to `cd` back to the main repo.
   - On `STATUS=failed_fallback_inplace`: degrade to in-place mode (`WORK_DIR=$REPO_ROOT`, branch created later in step 8).
   - On `STATUS=created|reused`: `WORK_DIR=$WORKTREE_PATH`, branch already created by skill.
   - With `--no-worktree`: `WORK_DIR=$REPO_ROOT`, branch created in step 8.
4. Resolve preset templates dir from `${CLAUDE_PLUGIN_ROOT}/templates/`.
5. Copy all template files to `${WORK_DIR}/all-docs/doc/<id>.<slug>/`:
   ```bash
   REQ_DIR="${WORK_DIR}/all-docs/doc/${feature_id}.${feature_slug}"
   mkdir -p "$REQ_DIR"
   cp -r ${CLAUDE_PLUGIN_ROOT}/templates/* "${REQ_DIR}/"
   ```
6. Edit progress.md (in `$REQ_DIR`):
   - Replace `{编号}` / `{id}` placeholders with feature_id
   - Replace `{需求短名}` / `{slug}` with feature_slug
   - Set `feature_id`, `feature_slug`, `preset` (read from preset.yml)
7. Write `mode` into `${REQ_DIR}/config.json` (only when `--mode != full`, since template default is already `full`):
   ```bash
   # BSD/macOS sed: use [[:space:]] (not \s)
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}/config.json"
   ```
8. **Create branch (only when worktree was skipped)**: with `--no-worktree` or after `failed_fallback_inplace`, run `git -C "$WORK_DIR" checkout -b feature/<feature_id>-<feature_slug>`. When the worktree skill already created the branch, skip.
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
      1. cd <WORK_DIR>             ← worktree mode only; --no-worktree skips this
      2. Edit all-docs/doc/<id>.<slug>/requirements.md (business needs)
      3. Run /cc-nexs:run <id> to start the pipeline
   ```

