---
description: Run only changed modules with exact-candidate success caching and dependency-aware bounded parallelism.
allowed-tools: Read, Bash
argument-hint: [--phase=build|test|both] [--dry-run] [--no-cache] [--max-parallel=N] [--config-root=path]
---

# /cc-nexs:build

Resolve the packaged deterministic executor and run:

```text
node <plugin-root>/lib/build-executor.mjs --cwd <assigned-feature-worktree> [--config-root <workspace-root>] [--phase build|test|both] [--dry-run] [--no-cache] [--max-parallel N]
```

The executor discovers `cc-nexs.config.yml` by walking from the assigned feature worktree to the workspace root (or uses `--config-root`), compares Git changes in that worktree against `paths_override.diff_base`, and selects modules whose `match` patterns intersect changed files plus their declared dependency closure. It then:

1. runs build before test;
2. runs independent matched modules concurrently up to `build_max_parallel` (default 2);
3. honors each module's `depends_on` list;
4. fails the phase when any command fails;
5. caches only successful commands against the exact Git candidate fingerprint outside the repository;
6. reuses a cached result only when HEAD, base, tracked diff, staged/unstaged diff, untracked content, phase, and command are unchanged.

Configuration example:

```yaml
paths_override:
  diff_base: master
  build_cache: true
  build_max_parallel: 2
  build_cmd: ""
  test_cmd: ""
  modules:
    - name: backend
      match:
        - "api-service/**"
      build_cmd: "cd api-service && mvn -q -DskipTests package"
      test_cmd: "cd api-service && mvn -q test"
      depends_on: []
    - name: web
      match:
        - "web/**"
      build_cmd: "cd web && pnpm --filter web build"
      test_cmd: "cd web && pnpm --filter web test"
      depends_on: []
    - name: e2e
      match:
        - "e2e/**"
      build_cmd: ""
      test_cmd: "cd e2e && pnpm test"
      depends_on:
        - backend
        - web
```

Use `--dry-run` to inspect selection. Use `--no-cache` only when the underlying tool has meaningful inputs outside Git/configuration. The final Lean local verification driver remains authoritative and may call this executor; `workflow.local_verify.reuse_passed=true` prevents rerunning that driver for an unchanged candidate.
