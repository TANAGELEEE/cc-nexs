---
description: Initialize a new feature directory by copying preset templates and creating progress.md.
allowed-tools: Read, Write, Edit, Bash
argument-hint: <feature_id> <feature_slug> [--mode=full|fast] [--sprints=N]
---

# /cc-nexs:init

Bootstrap a feature directory under `doc/`.

## Args

- `feature_id` — required
- `feature_slug` — required
- `--mode=full|fast` — pipeline mode (default `full`). `fast` enables 3-role merged single-sprint flow.
- `--sprints=N` — optional sprint count (planner can decide later in full mode; ignored in fast mode)

## Steps

1. Validate args. Parse `--mode` (default `full`); reject anything other than `full|fast`.
2. Compute `REQ_DIR = doc/<feature_id>.<feature_slug>/`
3. If REQ_DIR exists, refuse and print existing progress.md state.
4. Resolve preset templates dir from `${CLAUDE_PLUGIN_ROOT}/templates/`
5. Copy all template files to REQ_DIR:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/templates/* ${REQ_DIR}
   ```
6. Edit progress.md:
   - Replace `{编号}` / `{id}` placeholders with feature_id
   - Replace `{需求短名}` / `{slug}` with feature_slug
   - Set `feature_id`, `feature_slug`, `preset` (read from preset.yml)
7. Write `mode` into `${REQ_DIR}config.json` (only when `--mode != full`, since template default is already `full`):
   ```bash
   # BSD/macOS sed: use [[:space:]] (not \s)
   sed -i'' -E 's/("mode"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<MODE>"/' "${REQ_DIR}config.json"
   ```
8. Create branch: `git checkout -b feature/<feature_id>-<feature_slug>`
9. Print:
   ```
   ✅ Initialized doc/<id>.<slug>/
      Mode: <full | fast>
      Templates copied: <N> files
      Branch: feature/<id>-<slug>

   👉 Next:
      1. Edit doc/<id>.<slug>/requirements.md (business needs)
      2. Run /cc-nexs:run <id> to start the pipeline
   ```

