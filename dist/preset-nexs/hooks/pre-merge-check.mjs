#!/usr/bin/env node
// cc-nexs cross-platform PreToolUse hook: pre-merge checks.
//
// Triggers ONLY on real "merge into trunk" intents AND only in repos that have
// active cc-nexs pipeline state (doc/<id>/progress.md exists). This makes the
// hook opt-in per repo — multi-repo projects where some subprojects don't use
// cc-nexs are unaffected.
//
// Trigger detection:
//   - `git push <remote> master|main`
//   - `git merge <branch>` (NOT `git merge-base`, `git merge-tree`, etc.)
//   - `gh pr merge`
//
// Checks (only if any progress.md found in this repo):
//   1. preset.stack.build_cmd succeeds at repo root (skipped if cd target missing)
//   2. every progress.md TOUCHED BY THE COMMITS BEING PUSHED has current_state = COMPLETE
//      (scoped via `git diff --name-only <base>...HEAD`; falls back to checking every
//      progress.md in the repo if the base ref can't be resolved, so we fail safe —
//      never fail open — when the diff can't be computed)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let input = '';
try { input = readFileSync(0, 'utf-8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }

const cmd = parsed.command || parsed.tool_input?.command || '';
if (!cmd) process.exit(0);

// ---- trigger detection -----------------------------------------------------

function isPushToTrunk(c) {
  // Explicit: `git push <remote> master` or `git push <remote> main`
  if (/\bgit\s+push\b/.test(c) && /\b(master|main)\b/.test(c)) return true;
  // Implicit: `git push` with no refspec while on master/main (detected via current branch)
  if (/\bgit\s+push\s*$/.test(c) || /\bgit\s+push\s+origin\s*$/.test(c)) {
    try {
      const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      if (branch === 'master' || branch === 'main') return true;
    } catch { /* not in git repo, skip */ }
  }
  return false;
}
function isGhPrMerge(c) {
  return /\bgh\s+pr\s+merge\b/.test(c);
}

// Only block pushes to trunk (master/main) and GH PR merges (which target default branch).
// Plain `git merge <branch>` is allowed — feature → test merges happen during G2 deploy phase.
const isMerge = isPushToTrunk(cmd) || isGhPrMerge(cmd);
if (!isMerge) process.exit(0);

// ---- locate repo root ------------------------------------------------------

const cwd = process.cwd();
let repoRoot = cwd;
try {
  repoRoot = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8' }).trim();
} catch {
  // Not in a git repo — nothing to check
  process.exit(0);
}

// ---- opt-in: skip if no cc-nexs pipeline in this repo ----------------------

function findProgressFiles(root, depth = 0) {
  if (depth > 3) return [];
  const out = [];
  let ents;
  try { ents = readdirSync(root); } catch { return []; }
  for (const e of ents) {
    if (e.startsWith('.') || e === 'node_modules') continue;
    const full = join(root, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...findProgressFiles(full, depth + 1));
    else if (e === 'progress.md') out.push(full);
  }
  return out;
}

const docRoot = existsSync(join(repoRoot, 'doc')) ? join(repoRoot, 'doc') : null;
const pfs = docRoot ? findProgressFiles(docRoot) : [];

if (pfs.length === 0) {
  // This repo is not running a cc-nexs pipeline — silently allow the merge.
  process.exit(0);
}

// ---- locate preset ---------------------------------------------------------

const presetRoot = process.env.CLAUDE_PLUGIN_ROOT
  || process.env.PLUGIN_ROOT
  || process.env.CODEX_PLUGIN_ROOT
  || process.env.CC_NEXS_PLUGIN_ROOT
  || resolve(fileURLToPath(import.meta.url), '../..');

let stack = {};
const presetYml = join(presetRoot, 'preset.yml');
if (existsSync(presetYml)) {
  const text = readFileSync(presetYml, 'utf-8');
  const buildMatch = text.match(/\bbuild_cmd:\s*["']?([^"'\n]+)/);
  if (buildMatch) {
    stack.build_cmd = buildMatch[1].trim().replace(/["']$/, '');
  }
}

let fail = 0;

// ---- 1. build_cmd ----------------------------------------------------------

// Skip build if the cd target doesn't exist (preset designed for a different repo layout).
// Also skip if the build tool's config file is missing (e.g. mvn without pom.xml).
function buildCmdApplicable(buildCmd, root) {
  if (!buildCmd) return false;
  // Parse out leading `cd <dir>` patterns
  const cdMatch = buildCmd.match(/^cd\s+(\S+)/);
  let effectiveRoot = root;
  if (cdMatch) {
    const cdTarget = cdMatch[1];
    if (!existsSync(join(root, cdTarget))) {
      return false;
    }
    effectiveRoot = join(root, cdTarget);
  }
  // Check build tool config file existence
  const toolConfigs = [
    [/\bmvn\b/, 'pom.xml'],
    [/\bgradle\b/, 'build.gradle'],
    [/\bcargo\b/, 'Cargo.toml'],
    [/\bpnpm\b/, 'package.json'],
    [/\bnpm\b/, 'package.json'],
    [/\byarn\b/, 'package.json'],
    [/\bmake\b/, 'Makefile'],
  ];
  for (const [pattern, configFile] of toolConfigs) {
    if (pattern.test(buildCmd) && !existsSync(join(effectiveRoot, configFile))) {
      return false;
    }
  }
  return true;
}

if (stack.build_cmd) {
  if (!buildCmdApplicable(stack.build_cmd, repoRoot)) {
    console.error(`[cc-nexs pre-merge] build_cmd "${stack.build_cmd}" not applicable to this repo, skipping build check`);
  } else {
    console.error(`[cc-nexs pre-merge] running at ${repoRoot}: ${stack.build_cmd}`);
    try {
      execSync(stack.build_cmd, { cwd: repoRoot, stdio: 'inherit' });
    } catch {
      console.error(`[cc-nexs pre-merge] ❌ build failed`);
      fail = 1;
    }
  }
} else {
  console.error(`[cc-nexs pre-merge] (no build_cmd in preset, skipping build check)`);
}

// ---- 2. progress.md COMPLETE (scoped to files touched by this push) --------

// Base ref = the remote state this push would land on top of. Diffing against
// it (not just "every progress.md in the repo") means an unrelated in-flight
// requirement (still SPRINT_M1 elsewhere) never blocks a push that doesn't
// touch it.
function resolveBaseRef() {
  try {
    const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
      cwd: repoRoot, encoding: 'utf-8',
    }).trim();
    if (upstream) return upstream;
  } catch { /* current branch has no upstream configured */ }

  // gh pr merge (or no upstream): fall back to the remote's default branch.
  try {
    const head = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoRoot, encoding: 'utf-8',
    }).trim();
    return head.replace(/^refs\/remotes\//, '');
  } catch { /* no origin/HEAD */ }

  for (const guess of ['origin/master', 'origin/main']) {
    try {
      execSync(`git rev-parse --verify ${guess}`, { cwd: repoRoot, stdio: 'ignore' });
      return guess;
    } catch { /* try next */ }
  }
  return null;
}

// Returns null when the diff can't be scoped (unknown base ref, or `git diff`
// itself fails) so the caller can fail SAFE — check every progress.md — rather
// than fail OPEN by assuming nothing changed.
function findTouchedProgressFiles(baseRef) {
  if (!baseRef) return null;
  let out;
  try {
    out = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: repoRoot, encoding: 'utf-8',
    });
  } catch {
    return null;
  }
  const changed = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  return pfs.filter((pf) => changed.has(relative(repoRoot, pf).split(sep).join('/')));
}

const baseRef = resolveBaseRef();
const touched = findTouchedProgressFiles(baseRef);
const pfsToCheck = touched === null ? pfs : touched;

if (touched === null) {
  console.error('[cc-nexs pre-merge] could not scope diff to this push — falling back to checking every progress.md');
} else if (touched.length === 0) {
  console.error('[cc-nexs pre-merge] this push touches no progress.md — skipping COMPLETE check');
}

for (const pf of pfsToCheck) {
  const text = readFileSync(pf, 'utf-8');
  const m = text.match(/current_state:\s*(\S+)/);
  if (!m) continue;
  if (m[1] !== 'COMPLETE') {
    console.error(`[cc-nexs pre-merge] ❌ ${pf}: state=${m[1]}, expected COMPLETE`);
    fail = 1;
  }
}

if (fail) {
  console.error('[cc-nexs pre-merge] merge blocked. fix the above first.');
  process.exit(2);
}
console.error('[cc-nexs pre-merge] ✅ all checks passed');
process.exit(0);
