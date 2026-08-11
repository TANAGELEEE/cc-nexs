import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { createWorkspaceWorktrees } from './git-custodian.mjs';
import { parseImplementationOwnership } from './implementation-plan.mjs';
import { readProgressV2, recordRepositoryAssignments } from './progress-v2.mjs';

const PRE_G1_STATES = new Set([
  'REQ_DRAFTED',
  'RECON_DONE',
  'SPEC_DRAFTED',
  'SPEC_REVIEWING',
  'PARSE_SPEC_REVIEW',
  'SPEC_NEEDS_REVISION',
  'SPEC_PENDING_HUMAN',
]);

function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml'))
      || existsSync(join(current, '.cc-nexs', 'workspace.json'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('[cc-nexs] implementation worktree sync requires .cc-nexs/workspace.yml or workspace.json');
    }
    current = parent;
  }
}

function assertParentControl() {
  const role = process.env.CC_NEXS_ROLE || process.env.PI_SUBAGENT_CHILD_AGENT;
  if (role) {
    throw new Error(`[cc-nexs] implementation worktree sync is parent-only; role session ${role} cannot mutate workspace assignments`);
  }
}

function hasPortableAssignment(assignment) {
  return typeof assignment?.branch === 'string' && assignment.branch.length > 0
    && typeof assignment?.worktree === 'string' && assignment.worktree.length > 0;
}

/**
 * Materialize only repositories declared by a Fast/Full ownership table.
 *
 * This is deliberately a parent control action: the Planner/Fullstack child
 * authors spec.md, then the parent calls this helper before deterministic plan
 * validation or G1. Repeating the call after success is a read-only no-op.
 */
export function syncImplementationWorktrees({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
} = {}) {
  assertParentControl();
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const before = readProgressV2(progressFile);
  if (!['fast', 'full', 'lite'].includes(before.mode)) {
    throw new Error(`[cc-nexs] implementation worktree sync requires fast/full mode, found ${before.mode}`);
  }
  if (before.gates?.g1?.approved === true || !PRE_G1_STATES.has(before.state)) {
    throw new Error(`[cc-nexs] implementation worktree sync is allowed only before G1, found ${before.state}`);
  }

  const specFile = join(dirname(progressFile), 'spec.md');
  if (!existsSync(specFile)) throw new Error('[cc-nexs] implementation worktree sync requires spec.md');
  const workspaceRoot = findWorkspaceRoot(dirname(progressFile));
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const codeRepositories = workspace.repositories.filter((repository) => (
    repository.docs !== true && repository.id !== workspace.docs_repository
  ));
  const codeRepositoryIds = codeRepositories.map((repository) => repository.id);
  const parsed = parseImplementationOwnership(readFileSync(specFile, 'utf8'), {
    repositories: codeRepositoryIds,
    mode: before.mode,
  });

  // Historical specs without the machine block retain their single-worker
  // compatibility path and do not infer repository mutations.
  if (parsed.contractVersion === 0) {
    return {
      kind: 'implementation-worktree-sync', progressFile,
      feature: before.feature, contractVersion: 0, repositories: [], created: [], recovered: [], changed: false,
    };
  }

  const declared = [...new Set(parsed.assignments.map((assignment) => assignment.repository))].sort();
  const missing = declared.filter((repository) => !hasPortableAssignment(before.repositories?.[repository]));
  if (missing.length === 0) {
    return {
      kind: 'implementation-worktree-sync', progressFile,
      feature: before.feature, contractVersion: 1, repositories: declared, created: [], recovered: [], changed: false,
    };
  }

  const created = createWorkspaceWorktrees(workspace, {
    featureId: before.feature.id,
    featureSlug: before.feature.slug,
    repositoryIds: missing,
    recoverExisting: true,
  });
  recordRepositoryAssignments(progressFile, created, { workspaceRoot });
  return {
    kind: 'implementation-worktree-sync', progressFile,
    feature: before.feature, contractVersion: 1, repositories: declared,
    created: created.filter((assignment) => assignment.recovered !== true).map((assignment) => assignment.repository),
    recovered: created.filter((assignment) => assignment.recovered === true).map((assignment) => assignment.repository),
    changed: true,
  };
}

export const IMPLEMENTATION_PRE_G1_STATES = PRE_G1_STATES;
