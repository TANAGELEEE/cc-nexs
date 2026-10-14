import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import {
  resolveAssignedCodeRepositories,
  resolveFeatureProgress,
} from './approval-command.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { assertImplementationApprovalCurrent } from './implementation-plan.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const TOKEN_VERSION = 1;
const FULL_QA_DOC_PATHS = new Set(['test-cases.md', 'qa-scripts/**']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertParentControl() {
  const role = process.env.CC_NEXS_ROLE || process.env.PI_SUBAGENT_CHILD_AGENT;
  if (role) {
    throw new Error(`[cc-nexs] implementation delta control is parent-only; role session ${role} cannot attest its own paths`);
  }
}

function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml'))
      || existsSync(join(current, '.cc-nexs', 'workspace.json'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('[cc-nexs] implementation delta control requires .cc-nexs/workspace.yml or workspace.json');
    }
    current = parent;
  }
}

function git(worktree, args, options = {}) {
  try {
    return execFileSync('git', ['-C', worktree, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`[cc-nexs] git ${args.join(' ')} failed in ${worktree}: ${detail}`);
  }
}

function snapshotWorktree(worktree) {
  const temporary = mkdtempSync(join(tmpdir(), 'cc-nexs-implementation-delta-'));
  try {
    const temporaryIndex = join(temporary, 'index');
    const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const branch = git(worktree, ['branch', '--show-current']);
    const indexTree = git(worktree, ['write-tree']);
    if (!branch) throw new Error(`[cc-nexs] implementation worktree is detached: ${worktree}`);
    git(worktree, ['read-tree', head], { env: environment });
    git(worktree, ['add', '-A', '--', '.'], { env: environment });
    const tree = git(worktree, ['write-tree'], { env: environment });
    return { head, branch, indexTree, tree };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function changedPaths(worktree, beforeTree, afterTree) {
  if (beforeTree === afterTree) return [];
  const output = execFileSync('git', [
    '-C', worktree, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', beforeTree, afterTree,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return output.split('\0').filter(Boolean).map((path) => path.replace(/\\/g, '/'));
}

function globExpression(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`);
}

export function implementationPathAllowed(path, allowedPaths) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return allowedPaths.some((allowedPath) => {
    const pattern = allowedPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern === '.') return true;
    if (!/[*?]/.test(pattern)) return normalized === pattern || normalized.startsWith(`${pattern}/`);
    return globExpression(pattern).test(normalized);
  });
}

function encodeToken(payload) {
  const canonical = canonicalJson(payload);
  return Buffer.from(JSON.stringify({ payload, checksum: sha256(canonical) }), 'utf8').toString('base64url');
}

function decodeToken(token) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new Error('[cc-nexs] invalid implementation delta token');
  }
  if (!envelope?.payload || envelope.checksum !== sha256(canonicalJson(envelope.payload))) {
    throw new Error('[cc-nexs] invalid implementation delta token checksum');
  }
  if (envelope.payload.version !== TOKEN_VERSION) {
    throw new Error(`[cc-nexs] unsupported implementation delta token version: ${envelope.payload.version}`);
  }
  return envelope.payload;
}

function loadDeltaContext({ cwd, featureId, progressPath, assignmentIds, allowedDocPaths = [] }) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  if (!['fast', 'full', 'lite'].includes(progress.mode)) {
    throw new Error(`[cc-nexs] implementation delta control requires fast/full mode, found ${progress.mode}`);
  }
  if (progress.gates?.g1?.approved !== true) {
    throw new Error('[cc-nexs] implementation delta control requires an approved G1 binding');
  }
  const specFile = join(dirname(progressFile), 'spec.md');
  if (!existsSync(specFile)) throw new Error('[cc-nexs] implementation delta control requires spec.md');
  const repositoryIds = resolveAssignedCodeRepositories({ progressFile, progress });
  const parsed = assertImplementationApprovalCurrent(progress, readFileSync(specFile, 'utf8'), {
    repositories: repositoryIds,
    mode: progress.mode,
  });
  if (parsed.contractVersion !== 1) {
    throw new Error('[cc-nexs] implementation delta control is unavailable for the legacy single-worker contract');
  }

  const requested = [...new Set(assignmentIds || [])];
  if (requested.length === 0) throw new Error('[cc-nexs] implementation delta begin requires at least one --assignment');
  const byId = new Map(parsed.assignments.map((assignment) => [assignment.id, assignment]));
  const active = requested.map((id) => {
    const assignment = byId.get(id);
    if (!assignment) throw new Error(`[cc-nexs] unknown implementation assignment: ${id}`);
    return assignment;
  });
  const sprint = active[0].sprint;
  const wave = active[0].wave;
  if (active.some((assignment) => assignment.sprint !== sprint || assignment.wave !== wave)) {
    throw new Error('[cc-nexs] one implementation delta batch may contain only assignments from the same Sprint and Wave');
  }
  if (new Set(active.map((assignment) => assignment.repository)).size !== active.length) {
    throw new Error('[cc-nexs] one implementation delta batch cannot run the same repository twice');
  }

  const workspaceRoot = findWorkspaceRoot(dirname(progressFile));
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const workspaceById = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  const requestedDocPaths = [...new Set(allowedDocPaths || [])];
  if (requestedDocPaths.length > 0 && progress.mode !== 'full') {
    throw new Error('[cc-nexs] only Full first-wave QA may authorize implementation-batch docs paths');
  }
  const invalidDocPaths = requestedDocPaths.filter((path) => !FULL_QA_DOC_PATHS.has(path));
  if (invalidDocPaths.length > 0) {
    throw new Error(`[cc-nexs] unsupported implementation-batch docs allowance: ${invalidDocPaths.join(', ')}`);
  }
  for (const repositoryId of Object.keys(progress.repositories || {})) {
    if (!workspaceById.has(repositoryId)) {
      throw new Error(`[cc-nexs] progress references an unknown implementation repository: ${repositoryId}`);
    }
  }
  const docsRepositoryIds = workspace.repositories
    .filter((repository) => repository.docs === true || repository.id === workspace.docs_repository)
    .map((repository) => repository.id);
  const docsRepositorySet = new Set(docsRepositoryIds);
  const monitoredIds = [...new Set([
    ...repositoryIds,
    ...docsRepositoryIds.filter((repositoryId) => progress.repositories?.[repositoryId]),
  ])].sort();
  const repositories = Object.fromEntries(monitoredIds.map((repositoryId) => {
    const configured = workspaceById.get(repositoryId);
    const assigned = progress.repositories?.[repositoryId];
    if (!configured || !assigned?.worktree || !assigned?.branch) {
      throw new Error(`[cc-nexs] implementation repository ${repositoryId} has no assigned worktree`);
    }
    const worktree = resolve(workspaceRoot, assigned.worktree);
    if (!existsSync(worktree)) throw new Error(`[cc-nexs] implementation worktree is missing for ${repositoryId}`);
    const isDocs = docsRepositorySet.has(repositoryId);
    let docsAllowedPaths = [];
    if (isDocs && requestedDocPaths.length > 0) {
      const featureRelative = relative(worktree, dirname(progressFile)).replace(/\\/g, '/');
      if (featureRelative && featureRelative !== '..' && !featureRelative.startsWith('../')) {
        docsAllowedPaths = requestedDocPaths.map((path) => `${featureRelative}/${path}`);
      }
    }
    return [repositoryId, {
      worktree,
      branch: assigned.branch,
      active: isDocs ? null : active.find((assignment) => assignment.repository === repositoryId) || null,
      allowedPaths: isDocs ? docsAllowedPaths : null,
      isDocs,
    }];
  }));

  return {
    progressFile,
    progress,
    parsed,
    active,
    sprint,
    wave,
    repositories,
    allowedDocPaths: requestedDocPaths,
  };
}

export function beginImplementationDelta({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  assignmentIds = [],
  allowedDocPaths = [],
} = {}) {
  assertParentControl();
  const context = loadDeltaContext({ cwd, featureId, progressPath, assignmentIds, allowedDocPaths });
  const repositories = {};
  for (const [repositoryId, repository] of Object.entries(context.repositories)) {
    const snapshot = snapshotWorktree(repository.worktree);
    if (snapshot.branch !== repository.branch) {
      throw new Error(`[cc-nexs] implementation worktree branch mismatch for ${repositoryId}: expected ${repository.branch}, found ${snapshot.branch}`);
    }
    repositories[repositoryId] = {
      worktree: repository.worktree,
      branch: repository.branch,
      head: snapshot.head,
      index_tree: snapshot.indexTree,
      tree: snapshot.tree,
    };
  }
  const payload = {
    version: TOKEN_VERSION,
    feature_id: context.progress.feature.id,
    progress_file: resolve(context.progressFile),
    mode: context.progress.mode,
    g1_binding_sha256: sha256(canonicalJson(context.progress.gates.g1.binding)),
    assignments: context.active.map((assignment) => assignment.id).sort(),
    sprint: context.sprint,
    wave: context.wave,
    allowed_doc_paths: context.allowedDocPaths,
    repositories,
  };
  return {
    kind: 'implementation-delta-begin',
    progressFile: context.progressFile,
    assignments: payload.assignments,
    sprint: payload.sprint,
    wave: payload.wave,
    token: encodeToken(payload),
  };
}

export function endImplementationDelta({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  token,
} = {}) {
  assertParentControl();
  if (!token) throw new Error('[cc-nexs] implementation delta end requires --token');
  const payload = decodeToken(token);
  const context = loadDeltaContext({
    cwd,
    featureId,
    progressPath,
    assignmentIds: payload.assignments,
    allowedDocPaths: payload.allowed_doc_paths || [],
  });
  if (String(context.progress.feature.id) !== String(payload.feature_id)
    || resolve(context.progressFile) !== payload.progress_file
    || context.progress.mode !== payload.mode
    || context.sprint !== payload.sprint
    || context.wave !== payload.wave
    || sha256(canonicalJson(context.progress.gates.g1.binding)) !== payload.g1_binding_sha256) {
    throw new Error('[cc-nexs] implementation delta token no longer matches the approved feature context');
  }
  const currentIds = Object.keys(context.repositories).sort();
  const baselineIds = Object.keys(payload.repositories || {}).sort();
  if (canonicalJson(currentIds) !== canonicalJson(baselineIds)) {
    throw new Error('[cc-nexs] implementation repository set changed during the worker batch');
  }

  const changed = {};
  const violations = [];
  for (const repositoryId of currentIds) {
    const repository = context.repositories[repositoryId];
    const baseline = payload.repositories[repositoryId];
    if (repository.worktree !== baseline.worktree || repository.branch !== baseline.branch) {
      throw new Error(`[cc-nexs] implementation worktree assignment changed during the worker batch for ${repositoryId}`);
    }
    const after = snapshotWorktree(repository.worktree);
    if (after.head !== baseline.head || after.branch !== baseline.branch) {
      throw new Error(`[cc-nexs] implementation worker mutated Git HEAD or branch for ${repositoryId}`);
    }
    if (after.indexTree !== baseline.index_tree) {
      throw new Error(`[cc-nexs] implementation worker mutated the real Git index for ${repositoryId}`);
    }
    const paths = changedPaths(repository.worktree, baseline.tree, after.tree);
    changed[repositoryId] = paths;
    const allowedPaths = repository.isDocs
      ? repository.allowedPaths
      : repository.active?.allowedPaths || [];
    for (const path of paths) {
      if ((!repository.active && !repository.isDocs)
        || !implementationPathAllowed(path, allowedPaths)) {
        violations.push(`${repositoryId}:${path}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`[cc-nexs] implementation batch changed paths outside its approved assignments: ${violations.join(', ')}`);
  }
  return {
    kind: 'implementation-delta-end',
    progressFile: context.progressFile,
    assignments: payload.assignments,
    sprint: payload.sprint,
    wave: payload.wave,
    changed,
  };
}
