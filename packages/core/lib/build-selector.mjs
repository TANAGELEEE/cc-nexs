// cc-nexs core: build/test command selector.
//
// Decide which build / test commands to run for the current feature, based on
// the intersection of `git diff` against a base ref and per-module glob rules
// declared in cc-nexs.config.yml's paths_override.modules.
//
// Used by /cc-nexs:build (and any agent doing build verification).
//
// Selection rules:
//   1. Get changed files: `git diff --name-only <diff_base>...HEAD` (worktree HEAD).
//   2. For each module in mergedStack.modules, if any changed file matches any
//      of its `match` globs, mark the module as "hit".
//   3. Output the hit modules' build_cmd / test_cmd lists, in declaration order
//      (de-duplicated by command string).
//   4. If no module matches (e.g. doc-only change, or modules unset), fall back
//      to mergedStack.build_cmd / mergedStack.test_cmd.
//
// CLI usage:
//   node lib/build-selector.mjs [--cwd <path>] [--phase build|test|both] [--json]
// Default phase: both. Default cwd: process.cwd(). Default --json: false (human-readable).
//
// JSON output schema:
//   {
//     "diff_base": "main",
//     "changed_files": ["backend-java/sa-core/src/.../Foo.java", ...],
//     "matched_modules": ["backend"],
//     "build_cmds": ["cd backend-java && mvn -q -DskipTests compile"],
//     "test_cmds":  ["cd backend-java && mvn -q test"],
//     "fallback":   false,
//     "reason":     "1 module matched: backend"
//   }

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadConfig } from './config-loader.mjs';

// ---- glob matching ---------------------------------------------------------
// Minimal glob → regex. Supports: *, **, ?. No brace expansion, no negation.
// `**` matches zero or more path segments. `*` matches anything except '/'.
// We anchor at start; trailing /** also matches the directory itself.

function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const next = glob[i + 1];
    if (c === '*' && next === '*') {
      // ** : any number of path segments (including zero)
      // Common cases:
      //   "a/**"      → "a/" or "a/anything"
      //   "a/**/b"    → "a/b" or "a/x/b" or "a/x/y/b"
      //   "**/b"      → "b" or "x/b"
      const after = glob[i + 2];
      if (after === '/') {
        re += '(?:.*/)?';
        i += 2; // consume "**" + "/"
      } else if (after === undefined) {
        re += '.*';
        i += 1; // consume the second "*"
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+()|[]{}^$\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function matchAny(file, globs) {
  if (!Array.isArray(globs) || globs.length === 0) return false;
  for (const g of globs) {
    if (typeof g !== 'string' || !g) continue;
    if (globToRegex(g).test(file)) return true;
  }
  return false;
}

// ---- git diff --------------------------------------------------------------

function getChangedFiles(cwd, diffBase) {
  try {
    // Use 3-dot diff: changes on the feature branch that diverged from base.
    const out = execSync(`git diff --name-only ${diffBase}...HEAD`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tracked = out.split('\n').map((s) => s.trim()).filter(Boolean);
    // Include uncommitted (working tree + staged) changes too, so build runs reflect
    // what the user is about to commit, not just what's already pushed.
    const uncommittedOut = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const uncommitted = uncommittedOut
      .split('\n')
      .filter((line) => line.length > 3)
      .map((line) => {
        // porcelain v1 format: columns 1-2 are status (XY), column 3 is space, path starts at 4.
        // Renames are "XY old -> new" — keep the new name.
        const rest = line.substring(3);
        if (rest.includes(' -> ')) return rest.split(' -> ')[1].trim();
        // Strip surrounding quotes that git adds for paths with special chars.
        return rest.trim().replace(/^"(.*)"$/, '$1');
      });
    return Array.from(new Set([...tracked, ...uncommitted]));
  } catch (e) {
    // Diff failed (no base ref, detached HEAD, etc.). Empty set → fallback.
    return [];
  }
}

// ---- core selection --------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.cwd
 * @param {object} args.mergedStack — from loadConfig
 * @returns {{diff_base, changed_files, matched_modules, build_cmds, test_cmds, fallback, reason}}
 */
export function selectBuildCommands({ cwd, mergedStack }) {
  const diffBase = mergedStack.diff_base || 'main';
  const modules = Array.isArray(mergedStack.modules) ? mergedStack.modules : [];
  const fallbackBuild = mergedStack.build_cmd || '';
  const fallbackTest = mergedStack.test_cmd || '';

  const changedFiles = getChangedFiles(cwd, diffBase);

  if (modules.length === 0) {
    return {
      diff_base: diffBase,
      changed_files: changedFiles,
      matched_modules: [],
      build_cmds: fallbackBuild ? [fallbackBuild] : [],
      test_cmds: fallbackTest ? [fallbackTest] : [],
      fallback: true,
      reason: 'no modules declared; using top-level build_cmd / test_cmd',
    };
  }

  const matched = [];
  for (const m of modules) {
    if (!m || typeof m !== 'object' || !m.name) continue;
    const globs = Array.isArray(m.match) ? m.match : [];
    const hit = changedFiles.some((f) => matchAny(f, globs));
    if (hit) matched.push(m);
  }

  if (matched.length === 0) {
    return {
      diff_base: diffBase,
      changed_files: changedFiles,
      matched_modules: [],
      build_cmds: fallbackBuild ? [fallbackBuild] : [],
      test_cmds: fallbackTest ? [fallbackTest] : [],
      fallback: true,
      reason:
        changedFiles.length === 0
          ? `no changes vs ${diffBase}; falling back to top-level commands`
          : `no module matched (${changedFiles.length} files changed); falling back to top-level`,
    };
  }

  // De-dupe by command string while preserving order.
  const buildSet = new Set();
  const testSet = new Set();
  const buildCmds = [];
  const testCmds = [];
  for (const m of matched) {
    if (m.build_cmd && !buildSet.has(m.build_cmd)) {
      buildSet.add(m.build_cmd);
      buildCmds.push(m.build_cmd);
    }
    if (m.test_cmd && !testSet.has(m.test_cmd)) {
      testSet.add(m.test_cmd);
      testCmds.push(m.test_cmd);
    }
  }

  return {
    diff_base: diffBase,
    changed_files: changedFiles,
    matched_modules: matched.map((m) => m.name),
    build_cmds: buildCmds,
    test_cmds: testCmds,
    fallback: false,
    reason: `${matched.length} module(s) matched: ${matched.map((m) => m.name).join(', ')}`,
  };
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = { cwd: process.cwd(), phase: 'both', json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = resolve(argv[++i]);
    else if (a === '--phase') args.phase = argv[++i];
    else if (a === '--json') args.json = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const { mergedStack } = loadConfig({ projectRoot: args.cwd });
  const result = selectBuildCommands({ cwd: args.cwd, mergedStack });

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Human-readable: print one command per line, prefixed with phase tag,
  // so a shell can `eval` per-line. Plus a header with the reason on stderr.
  process.stderr.write(`[cc-nexs build-selector] ${result.reason}\n`);
  if (result.changed_files.length) {
    process.stderr.write(
      `[cc-nexs build-selector] changed files (${result.changed_files.length}): ` +
        result.changed_files.slice(0, 5).join(', ') +
        (result.changed_files.length > 5 ? ' …' : '') +
        '\n',
    );
  }
  const phases = args.phase === 'both' ? ['build', 'test'] : [args.phase];
  for (const p of phases) {
    const cmds = p === 'build' ? result.build_cmds : result.test_cmds;
    for (const c of cmds) process.stdout.write(`${p}\t${c}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
