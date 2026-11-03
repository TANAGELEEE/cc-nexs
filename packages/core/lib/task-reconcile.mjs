import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { findWorkspaceRoot } from './candidate-context.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { classifyMergedWork } from './git-custodian.mjs';
import { transitionMarkdown, transitionState } from './progress-io.mjs';
import { readTaskProgress } from './worktree-reclaim.mjs';

// Records COMPLETE for a task whose work already reached its bases outside the
// controller, such as a task from a retired mode or one merged by hand. Every
// assigned code repository must prove its work is in the base (ancestry or
// equivalent patches) and the user confirms the exact plan that was shown.
// The docs archive and worktree cleanup stay separate steps.
export function reconcileTask({ cwd = process.cwd(), featureId, progressPath = null, confirm = null } = {}) {
  if (!featureId) throw new Error('feature id is required');
  const progressFile = progressPath ? resolve(cwd, progressPath) : resolveFeatureProgress({ cwd, featureId });
  const read = readTaskProgress(progressFile);
  if (!read) throw new Error(`[cc-nexs] cannot read task state: ${progressFile}`);
  const { progress, legacy } = read;
  if (String(progress.feature.id) !== String(featureId) && Number(progress.feature.id) !== Number(featureId)) {
    throw new Error(`feature mismatch: requested ${featureId}, found ${progress.feature.id}`);
  }
  const result = { kind: 'task-reconcile', feature: progress.feature, state: progress.state, legacy, progressFile };
  if (progress.state === 'COMPLETE') return { ...result, status: 'complete', repositories: [] };

  const workspace = loadWorkspaceConfig({ projectRoot: findWorkspaceRoot(cwd, progressFile) });
  const docs = new Set(workspace.repositories.filter((item) => item.docs === true || item.id === workspace.docs_repository).map((item) => item.id));
  const repositories = [];
  for (const [id, assignment] of Object.entries(progress.repositories || {})) {
    if (docs.has(id)) continue;
    const repository = workspace.repositories.find((item) => item.id === id);
    if (!repository) { repositories.push({ repository: id, status: 'unknown', reason: 'not in workspace config' }); continue; }
    const baseBranch = assignment?.base_branch || repository.base_branch;
    const head = resolveWorkHead(repository.absolute_path, assignment);
    if (!head) { repositories.push({ repository: id, baseBranch, status: 'unknown', reason: 'no candidate ref, or branch with commits beyond its recorded base, to compare' }); continue; }
    repositories.push({ repository: id, baseBranch, head: head.commit, source: head.ref, ...classifyMergedWork({ repo: repository.absolute_path, head: head.commit, baseBranch }) });
  }
  if (!repositories.length) return { ...result, status: 'blocked', repositories, reason: 'no assigned code repository to prove' };
  const token = createHash('sha256').update(JSON.stringify({
    feature: progress.feature, state: progress.state,
    repositories: repositories.map(({ repository, head = null, status, relation = null }) => ({ repository, head, status, relation })),
  })).digest('hex').slice(0, 12);
  if (repositories.some((item) => item.status !== 'merged')) return { ...result, status: 'blocked', repositories };
  if (confirm === null) return { ...result, status: 'ready', token, repositories };
  if (confirm !== token) throw new Error('[cc-nexs] reconcile plan changed since it was shown; rerun reconcile without --confirm and review the new plan');

  const reason = `reconciled after confirmation: ${repositories.map((item) => `${item.repository} ${item.relation} in origin/${item.baseBranch}`).join('; ')}`;
  const markdown = join(dirname(progressFile), 'progress.md');
  if (legacy) {
    writeLegacyCompletion(progressFile, reason);
    if (existsSync(markdown)) transitionMarkdown(markdown, { from: progress.state, to: 'COMPLETE', reason });
  } else {
    if (!existsSync(markdown)) throw new Error(`[cc-nexs] progress.md not found beside ${progressFile}`);
    transitionState(markdown, { from: progress.state, to: 'COMPLETE', reason });
  }
  return { ...result, status: 'reconciled', from: progress.state, state: 'COMPLETE', repositories };
}

// A candidate ref is the work by definition. A plain branch counts only when it
// has commits beyond its recorded base: a fresh branch sits on the base tip and
// would otherwise look merged.
function resolveWorkHead(repo, assignment) {
  const commit = (ref) => {
    try { return execFileSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
  const candidate = assignment?.candidate?.ref && commit(assignment.candidate.ref);
  if (candidate) return { ref: assignment.candidate.ref, commit: candidate };
  if (!assignment?.branch || !assignment?.base_commit) return null;
  for (const ref of [`refs/heads/${assignment.branch}`, `refs/remotes/origin/${assignment.branch}`]) {
    const head = commit(ref);
    if (!head) continue;
    const ahead = execFileSync('git', ['-C', repo, 'rev-list', '--count', `${assignment.base_commit}..${head}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return Number(ahead) > 0 ? { ref, commit: head } : null;
  }
  return null;
}

// Retired-mode progress no longer passes v2 validation, so its completion is
// appended directly while keeping the event ledger contiguous.
function writeLegacyCompletion(file, reason) {
  const progress = JSON.parse(readFileSync(file, 'utf8'));
  const timestamp = new Date().toISOString();
  progress.events = Array.isArray(progress.events) ? progress.events : [];
  progress.events.push({
    id: randomUUID(), sequence: progress.events.length + 1, timestamp,
    type: 'state.transition', actor: 'orchestrator', from: progress.state, to: 'COMPLETE', reason,
  });
  progress.revision = (Number.isInteger(progress.revision) ? progress.revision : 0) + 1;
  progress.state = 'COMPLETE';
  progress.updated_at = timestamp;
  writeFileSync(`${file}.tmp`, `${JSON.stringify(progress, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
