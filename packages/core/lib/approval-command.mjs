import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { approveDeployGate, approveHumanGate, transitionState } from './progress-io.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const GATES = new Set(['g1', 'g2']);
const SKIP_DIRS = new Set([
  '.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor',
]);

export function approveFeatureGate({
  cwd = process.cwd(),
  featureId,
  gate,
  sprint = null,
  approver = null,
  progressPath = null,
} = {}) {
  if (!featureId) throw new Error('feature id is required');
  if (!GATES.has(gate)) throw new Error(`unsupported gate: ${gate || '(missing)'}`);

  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const markdownFile = join(dirname(progressFile), 'progress.md');
  if (!existsSync(markdownFile)) throw new Error(`progress.md is missing beside ${progressFile}`);

  const before = readProgressV2(progressFile);
  if (!sameFeatureId(before.feature.id, featureId)) {
    throw new Error(`feature mismatch: requested ${featureId}, found ${before.feature.id}`);
  }

  const actor = approver || resolveGitApprover(dirname(progressFile));
  if (gate === 'g1') {
    const existing = before.gates.g1;
    if (existing?.approved && before.state !== 'SPEC_PENDING_HUMAN') {
      return approvalResult({ progressFile, progress: before, gate, sprint: null, approval: existing, alreadyApproved: true });
    }
    if (before.state !== 'SPEC_PENDING_HUMAN') {
      throw new Error(`G1 requires SPEC_PENDING_HUMAN, found ${before.state}`);
    }
    if (!existing?.approved) approveHumanGate(markdownFile, { approver: actor });
    transitionState(markdownFile, {
      from: 'SPEC_PENDING_HUMAN',
      to: 'SPEC_APPROVED',
      reason: 'human approved',
    });
  } else {
    const stateSprint = parseDeployGateSprint(before.state);
    if (before.state !== 'DEPLOY_GATE' && stateSprint === null) {
      const requestedSprint = normalizeSprint(sprint);
      const existing = requestedSprint === null
        ? before.gates.g2
        : before.gates.g2?.sprints?.[String(requestedSprint)];
      if (existing?.approved) {
        return approvalResult({ progressFile, progress: before, gate, sprint: requestedSprint, approval: existing, alreadyApproved: true });
      }
      throw new Error(`G2 requires DEPLOY_GATE or SPRINT_<N>_DEPLOY_GATE, found ${before.state}`);
    }

    let requestedSprint = normalizeSprint(sprint);
    if (stateSprint !== null) {
      if (requestedSprint !== null && requestedSprint !== stateSprint) {
        throw new Error(`sprint mismatch: state is M${stateSprint}, requested M${requestedSprint}`);
      }
      requestedSprint = stateSprint;
    } else {
      // Fast mode has a single deploy gate. Accept an optional M1 for a uniform CLI surface.
      if (requestedSprint !== null && requestedSprint !== 1) {
        throw new Error(`fast-mode DEPLOY_GATE does not accept sprint M${requestedSprint}`);
      }
      requestedSprint = null;
    }

    const existing = requestedSprint === null
      ? before.gates.g2
      : before.gates.g2?.sprints?.[String(requestedSprint)];
    if (existing?.approved) {
      return approvalResult({ progressFile, progress: before, gate, sprint: requestedSprint, approval: existing, alreadyApproved: true });
    }
    approveDeployGate(markdownFile, { approver: actor, sprint: requestedSprint });
  }

  const after = readProgressV2(progressFile);
  const effectiveSprint = gate === 'g2' ? parseApprovedSprint(after, sprint) : null;
  const approval = gate === 'g1'
    ? after.gates.g1
    : effectiveSprint === null ? after.gates.g2 : after.gates.g2.sprints[String(effectiveSprint)];
  return approvalResult({ progressFile, progress: after, gate, sprint: effectiveSprint, approval, alreadyApproved: false });
}

export function resolveFeatureProgress({ cwd = process.cwd(), featureId, progressPath = null }) {
  if (progressPath) {
    const explicit = resolve(cwd, progressPath);
    if (!existsSync(explicit)) throw new Error(`progress file not found: ${explicit}`);
    return explicit;
  }

  const direct = findProgressInAncestors(cwd, featureId);
  if (direct) return direct;

  const roots = discoverWorkspaceRoots(resolve(cwd));
  const candidates = [];
  for (const root of roots) {
    for (const [searchRoot, depth] of [
      [join(root, 'doc'), 2],
      [join(root, 'all-docs', 'doc'), 2],
      [join(root, '.worktrees'), 5],
    ]) {
      findProgressCandidates(searchRoot, featureId, depth, candidates);
    }
  }

  const unique = dedupePaths(candidates);
  if (unique.length === 1) return unique[0];
  const worktreeMatches = unique.filter((path) => path.includes(`${join('.worktrees', String(featureId))}-`));
  if (worktreeMatches.length === 1) return worktreeMatches[0];
  if (unique.length === 0) throw new Error(`no progress.json found for feature ${featureId} from ${cwd}`);
  throw new Error(`multiple progress.json files found for feature ${featureId}; pass --progress explicitly:\n${unique.map((path) => `- ${path}`).join('\n')}`);
}

export function normalizeSprint(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^M?(\d+)$/i);
  if (!match || Number(match[1]) < 1) throw new Error(`invalid sprint: ${value}`);
  return Number(match[1]);
}

function approvalResult({ progressFile, progress, gate, sprint, approval, alreadyApproved }) {
  return {
    feature: progress.feature,
    mode: progress.mode,
    state: progress.state,
    gate,
    sprint,
    approver: approval.approver,
    approvedAt: approval.approved_at,
    alreadyApproved,
    progressFile,
  };
}

function parseDeployGateSprint(state) {
  const match = String(state).match(/^SPRINT_(\d+)_DEPLOY_GATE$/);
  return match ? Number(match[1]) : null;
}

function parseApprovedSprint(progress, requested) {
  const stateSprint = parseDeployGateSprint(progress.state);
  if (stateSprint !== null) return stateSprint;
  const normalized = normalizeSprint(requested);
  return normalized === 1 && progress.mode !== 'full' ? null : normalized;
}

function sameFeatureId(left, right) {
  const a = String(left);
  const b = String(right);
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a === b;
}

function resolveGitApprover(cwd) {
  try {
    const value = execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (value) return value;
  } catch { /* fall through */ }
  return process.env.USER || process.env.USERNAME || 'unknown';
}

function findProgressInAncestors(cwd, featureId) {
  let current = resolve(cwd);
  while (true) {
    const progress = join(current, 'progress.json');
    if (matchesFeature(progress, featureId)) return progress;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function discoverWorkspaceRoots(cwd) {
  const roots = new Set([cwd]);
  let current = cwd;
  while (true) {
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml'))) roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  findWorkspaceRoots(cwd, 0, 2, roots);
  return [...roots];
}

function findWorkspaceRoots(root, depth, maxDepth, roots) {
  if (depth > maxDepth || !isDirectory(root)) return;
  if (existsSync(join(root, '.cc-nexs', 'workspace.yml'))) roots.add(root);
  if (depth === maxDepth) return;
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
    findWorkspaceRoots(join(root, entry.name), depth + 1, maxDepth, roots);
  }
}

function findProgressCandidates(root, featureId, maxDepth, out, depth = 0) {
  if (depth > maxDepth || !isDirectory(root)) return;
  const progress = join(root, 'progress.json');
  if (matchesFeature(progress, featureId)) out.push(progress);
  if (depth === maxDepth) return;
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
    findProgressCandidates(join(root, entry.name), featureId, maxDepth, out, depth + 1);
  }
}

function matchesFeature(progressFile, featureId) {
  if (!existsSync(progressFile)) return false;
  try {
    const progress = JSON.parse(readFileSync(progressFile, 'utf8'));
    return sameFeatureId(progress?.feature?.id, featureId);
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.worktrees');
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function safeReadDir(path) {
  try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}

function dedupePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const path of paths) {
    let key;
    try { key = realpathSync(path); } catch { key = resolve(path); }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}
