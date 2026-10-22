import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { loadWorkspaceConfig } from './config-loader.mjs';
import { cleanupMergedWorktree, isWorktreeRegistered, removeIntegrationWorktree } from './git-custodian.mjs';
import { readProgressV2 } from './progress-v2.mjs';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function findProgressFiles(dir, depth = 0) {
  if (!existsSync(dir) || depth > 8) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Worktrees carry installed dependencies; progress state never lives inside them.
    if ((entry.name.startsWith('.') && depth > 0) || entry.name === 'node_modules') continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findProgressFiles(target, depth + 1));
    else if (entry.isFile() && entry.name === 'progress.json') files.push(target);
  }
  return files;
}

export function discoverProgressFiles(root, workspace) {
  const docsSource = workspace?.repositories.find((repo) => repo.id === workspace.docs_repository)?.absolute_path || join(root, 'all-docs');
  return new Set([
    ...findProgressFiles(join(docsSource, 'doc')),
    ...findProgressFiles(join(docsSource, 'hotfix')),
    ...findProgressFiles(join(root, '.cc-nexs', 'hotfixes')),
    ...(workspace ? findProgressFiles(workspace.worktree_root) : []),
  ]);
}

export function findWorkspaceRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml')) || existsSync(join(current, '.cc-nexs', 'workspace.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`[cc-nexs] workspace root not found from ${cwd}`);
    current = parent;
  }
}

function readTasks(root, workspace) {
  const byWorktree = new Map();
  const byFeature = new Map();
  for (const file of discoverProgressFiles(root, workspace)) {
    let progress;
    try { progress = readProgressV2(file); } catch { continue; }
    const task = { id: progress.feature?.id, state: progress.state, active: progress.state !== 'COMPLETE', progress };
    if (task.id) byFeature.set(task.id, task);
    for (const [repositoryId, assignment] of Object.entries(progress.repositories || {})) {
      if (!assignment?.worktree) continue;
      byWorktree.set(resolve(root, assignment.worktree), { ...task, repositoryId, assignment });
    }
  }
  return { byWorktree, byFeature };
}

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function isAncestor(repo, ancestor, descendant) {
  try { git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; } catch { return false; }
}

// A `.git` pointer file whose gitdir is gone marks a worktree Git already forgot.
function isStaleWorktreePointer(path) {
  const pointer = join(path, '.git');
  if (!existsSync(pointer) || !lstatSync(pointer).isFile()) return false;
  const match = readFileSync(pointer, 'utf8').match(/^gitdir:\s*(.+)$/m);
  if (!match) return false;
  const gitdir = isAbsolute(match[1].trim()) ? match[1].trim() : resolve(path, match[1].trim());
  return !existsSync(gitdir);
}

function sizeOf(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try { stat = lstatSync(current); } catch { continue; }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      try { for (const name of readdirSync(current)) stack.push(join(current, name)); } catch {}
    } else total += stat.size;
  }
  return total;
}

function classifyWorktree({ workspace, tasks, worktree, repositoryId }) {
  const entry = { kind: 'worktree', path: worktree, repository: repositoryId };
  const repository = workspace.repositories.find((item) => item.id === repositoryId);
  if (!repository) return { ...entry, action: 'keep', reason: 'not a configured repository' };
  entry.repo = repository.absolute_path;
  const registered = isWorktreeRegistered(git(repository.absolute_path, ['worktree', 'list', '--porcelain']), worktree);
  if (!registered) {
    return isStaleWorktreePointer(worktree)
      ? { ...entry, kind: 'stale-worktree', action: 'reclaim', reason: 'Git no longer tracks this worktree' }
      : { ...entry, action: 'keep', reason: 'not a registered worktree; inspect manually' };
  }
  const task = tasks.byWorktree.get(resolve(worktree));
  if (task?.active) {
    const hint = /BASE_MERGE_BLOCKED$/.test(task.state) ? '; rerun release-base to finish cleanup' : '';
    return { ...entry, action: 'keep', reason: `active task ${task.id} (${task.state})${hint}` };
  }
  // A fresh worktree sits on its base tip and would look merged; only completed tasks prove it is done.
  if (!task) return { ...entry, action: 'keep', reason: 'no task state found; inspect manually' };
  if (git(worktree, ['status', '--porcelain'])) return { ...entry, action: 'keep', reason: 'uncommitted or untracked changes' };
  const branch = git(worktree, ['branch', '--show-current']);
  if (!branch) return { ...entry, action: 'keep', reason: 'detached HEAD' };
  const baseBranch = task?.assignment?.base_branch || repository.base_branch;
  const base = `refs/remotes/origin/${baseBranch}`;
  const head = git(worktree, ['rev-parse', 'HEAD']);
  // Uses the last fetched base; reclaim re-fetches and re-proves before removal.
  if (!isAncestor(repository.absolute_path, head, base)) {
    return { ...entry, branch, head, action: 'keep', reason: `not merged into origin/${baseBranch} (squash merges are not detected)` };
  }
  return {
    ...entry, branch, head, baseBranch, action: 'reclaim',
    candidateRef: task.assignment?.candidate?.ref || null,
    reason: `task ${task.id} complete and merged`,
  };
}

function classifyTestConflict({ workspace, tasks, worktree, featureId, attemptId, repositoryId }) {
  const entry = { kind: 'test-conflict', path: worktree, repository: repositoryId, repo: workspace.repositories.find((item) => item.id === repositoryId)?.absolute_path || null };
  const latest = tasks.byFeature.get(featureId)?.progress.delivery?.test?.attempts?.at(-1);
  if (latest?.id === attemptId && latest.status === 'merge_conflict' && latest.invalidated_at == null) {
    return { ...entry, action: 'keep', reason: `active conflict for ${featureId} ${attemptId}` };
  }
  return { ...entry, action: 'reclaim', reason: tasks.byFeature.has(featureId) ? `${attemptId} is no longer the active conflict` : 'no task state found' };
}

export function inventoryWorktrees({ cwd = process.cwd(), sizes = false } = {}) {
  const root = findWorkspaceRoot(cwd);
  const workspace = loadWorkspaceConfig({ projectRoot: root });
  if (!workspace) throw new Error('[cc-nexs] workspace config is required for worktree inventory');
  const tasks = readTasks(root, workspace);
  const entries = [];
  for (const key of directories(workspace.worktree_root)) {
    for (const repositoryId of directories(join(workspace.worktree_root, key))) {
      entries.push(classifyWorktree({ workspace, tasks, worktree: join(workspace.worktree_root, key, repositoryId), repositoryId }));
    }
  }
  const conflictRoot = join(root, '.cc-nexs', 'runtime', 'test-conflicts');
  for (const featureId of directories(conflictRoot)) {
    for (const attemptId of directories(join(conflictRoot, featureId))) {
      for (const repositoryId of directories(join(conflictRoot, featureId, attemptId))) {
        entries.push(classifyTestConflict({ workspace, tasks, worktree: join(conflictRoot, featureId, attemptId, repositoryId), featureId, attemptId, repositoryId }));
      }
    }
  }
  for (const entry of entries) {
    entry.display = relative(root, entry.path) || '.';
    if (sizes) entry.bytes = sizeOf(entry.path);
  }
  return { kind: 'worktree-inventory', root, workspace, conflictRoot, entries, token: planToken(entries) };
}

// The token binds confirmation to the exact set and HEADs that were shown.
function planToken(entries) {
  const plan = entries.filter((entry) => entry.action === 'reclaim')
    .map(({ kind, display, branch = null, head = null }) => ({ kind, path: display.replaceAll('\\', '/'), branch, head }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 12);
}

export function reclaimWorktrees({ cwd = process.cwd(), confirm = null, sizes = false } = {}) {
  const inventory = inventoryWorktrees({ cwd, sizes });
  if (confirm === null) return { ...inventory, kind: 'worktree-reclaim', applied: false };
  if (confirm !== inventory.token) {
    throw new Error('[cc-nexs] reclaim plan changed since it was shown; rerun reclaim-worktrees without --confirm and review the new plan');
  }
  const removed = [];
  const failed = [];
  for (const entry of inventory.entries.filter((item) => item.action === 'reclaim')) {
    try {
      if (entry.kind === 'worktree') {
        cleanupMergedWorktree({ repo: entry.repo, worktree: entry.path, branch: entry.branch, baseBranch: entry.baseBranch, candidateRef: entry.candidateRef });
      } else if (entry.kind === 'test-conflict' && entry.repo) {
        removeIntegrationWorktree({ repo: entry.repo, worktree: entry.path, root: inventory.conflictRoot });
      } else {
        const within = entry.kind === 'test-conflict' ? inventory.conflictRoot : inventory.workspace.worktree_root;
        const rel = relative(within, entry.path);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`[cc-nexs] unsafe reclaim path: ${entry.path}`);
        rmSync(entry.path, { recursive: true, force: true });
        if (entry.repo) { try { git(entry.repo, ['worktree', 'prune']); } catch {} }
      }
      removed.push(entry);
    } catch (error) {
      failed.push({ ...entry, error: error.message });
    }
  }
  pruneEmptyParents(inventory.workspace.worktree_root, 1);
  pruneEmptyParents(inventory.conflictRoot, 2);
  return { ...inventory, kind: 'worktree-reclaim', applied: true, removed, failed };
}

function pruneEmptyParents(root, depth) {
  for (const name of directories(root)) {
    const path = join(root, name);
    if (depth > 1) pruneEmptyParents(path, depth - 1);
    if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true });
  }
}

function formatBytes(bytes) {
  if (bytes === undefined) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return ` [${value.toFixed(unit ? 1 : 0)} ${units[unit]}]`;
}

export function formatInventory(result) {
  const reclaimable = result.entries.filter((entry) => entry.action === 'reclaim');
  const lines = [`Worktree inventory: ${reclaimable.length} reclaimable, ${result.entries.length - reclaimable.length} kept`];
  for (const entry of result.entries) {
    lines.push(`  ${entry.action === 'reclaim' ? 'RECLAIM' : 'KEEP   '} ${entry.kind.padEnd(14)} ${entry.display}  ${entry.reason}${formatBytes(entry.bytes)}`);
  }
  if (reclaimable.length) {
    const total = reclaimable.every((entry) => entry.bytes !== undefined) ? `, ${formatBytes(reclaimable.reduce((sum, entry) => sum + entry.bytes, 0)).trim()}` : '';
    lines.push(`Reclaim locally (remote branches are never deleted)${total}: cc-nexs reclaim-worktrees --confirm ${result.token}`);
  }
  return lines;
}
