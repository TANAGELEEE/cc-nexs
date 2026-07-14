import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PROGRESS_SCHEMA_VERSION = 2;

export function createProgressV2({ featureId, featureSlug, preset, mode = 'fast', repositories = [] }) {
  const now = new Date().toISOString();
  return {
    schema_version: PROGRESS_SCHEMA_VERSION,
    feature: { id: featureId, slug: featureSlug },
    preset,
    mode,
    state: 'INIT',
    revision: 0,
    created_at: now,
    updated_at: now,
    counters: { review_revision: 0, fix_per_bug: {}, evaluator_reject: 0 },
    sprint: { enabled: mode === 'full', current: 0, total: 0, status: {} },
    gates: { g1: { approved: false }, g2: { approved: false, sprints: {} } },
    repositories: Object.fromEntries(repositories.map((id) => [id, { branch: null, worktree: null, candidate: null }])),
    events: [],
  };
}

export function validateProgressV2(progress) {
  const errors = [];
  if (!progress || typeof progress !== 'object') errors.push('progress must be an object');
  if (progress?.schema_version !== PROGRESS_SCHEMA_VERSION) errors.push('schema_version must be 2');
  if (!progress?.feature?.id || !progress?.feature?.slug) errors.push('feature.id and feature.slug are required');
  if (!['fast', 'full', 'hotfix', 'lite'].includes(progress?.mode)) errors.push('mode is invalid');
  if (typeof progress?.state !== 'string' || !progress.state) errors.push('state is required');
  if (!Number.isInteger(progress?.revision) || progress.revision < 0) errors.push('revision must be a non-negative integer');
  if (!Array.isArray(progress?.events)) errors.push('events must be an array');
  else {
    let expected = 1;
    const ids = new Set();
    for (const event of progress.events) {
      if (event.sequence !== expected) errors.push(`event sequence must be contiguous at ${expected}`);
      expected += 1;
      if (!event.id || ids.has(event.id)) errors.push('event ids must be present and unique');
      ids.add(event.id);
    }
    if (progress.revision !== progress.events.length) errors.push('revision must equal events.length');
  }
  for (const [repo, assignment] of Object.entries(progress?.repositories || {})) {
    const worktree = assignment?.worktree;
    if (worktree !== null && (typeof worktree !== 'string' || worktree.startsWith('/') || worktree === '..' || worktree.startsWith('../') || /^[A-Za-z]:[\\/]/.test(worktree))) {
      errors.push(`repository ${repo} worktree must be workspace-relative`);
    }
  }
  return errors;
}

export function readProgressV2(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateProgressV2(value);
  if (errors.length) throw new Error(`[cc-nexs] invalid ${basename(file)}: ${errors.join('; ')}`);
  return value;
}

export function writeProgressV2(file, progress) {
  const errors = validateProgressV2(progress);
  if (errors.length) throw new Error(`[cc-nexs] refusing invalid progress: ${errors.join('; ')}`);
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(progress, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}

export function appendProgressEvent(file, {
  type,
  actor = 'orchestrator',
  from = null,
  to = null,
  reason = '',
  data = {},
  expectedRevision = null,
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
}) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  if (progress.events.some((event) => event.id === eventId)) return progress;
  if (from !== null && progress.state !== from) {
    throw new Error(`[cc-nexs] state mismatch: expected ${from}, found ${progress.state}`);
  }
  if (to !== null) progress.state = to;
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: eventId,
    sequence: progress.revision,
    timestamp,
    type,
    actor,
    ...(from !== null && { from }),
    ...(to !== null && { to }),
    ...(reason && { reason }),
    ...(Object.keys(data).length && { data }),
  });
  writeProgressV2(file, progress);
  return progress;
}

export function approveProgressGate(file, { gate, approver, sprint = null, expectedRevision = null }) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  if (!['g1', 'g2'].includes(gate)) throw new Error(`[cc-nexs] unknown gate: ${gate}`);
  const timestamp = new Date().toISOString();
  if (gate === 'g2' && sprint !== null) {
    progress.gates.g2.sprints[String(sprint)] = { approved: true, approver, approved_at: timestamp };
  } else {
    progress.gates[gate] = { ...progress.gates[gate], approved: true, approver, approved_at: timestamp };
  }
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'gate.approved', actor: approver,
    data: { gate, ...(sprint !== null && { sprint }) },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function updateProgressCounters(file, { counters, actor = 'orchestrator', reason = '', expectedRevision = null }) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  progress.counters = { ...progress.counters, ...counters };
  const timestamp = new Date().toISOString();
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'counters.updated', actor,
    ...(reason && { reason }), data: { counters },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function recordRepositoryAssignments(file, assignments, { workspaceRoot, expectedRevision = null } = {}) {
  if (!workspaceRoot) throw new Error('[cc-nexs] workspaceRoot is required for portable assignments');
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  for (const item of assignments) {
    const worktree = relative(resolve(workspaceRoot), resolve(item.worktree));
    if (!worktree || worktree === '..' || worktree.startsWith(`..${sep}`) || resolve(worktree) === worktree) {
      throw new Error(`[cc-nexs] worktree escapes workspace root: ${item.repository}`);
    }
    progress.repositories[item.repository] = {
      branch: item.branch,
      worktree,
      base_branch: item.baseBranch || null,
      base_commit: item.baseCommit || null,
      candidate: null,
    };
  }
  const timestamp = new Date().toISOString();
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'workspace.worktrees_created', actor: 'git-custodian',
    data: { repositories: Object.entries(progress.repositories).map(([repository, value]) => ({
      repository,
      branch: value.branch,
      worktree: value.worktree,
      base_branch: value.base_branch || null,
      base_commit: value.base_commit || null,
    })) },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function recordRepositoryCandidate(file, repository, candidate, { expectedRevision = null } = {}) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  if (!progress.repositories[repository]) throw new Error(`[cc-nexs] repository is not assigned: ${repository}`);
  progress.repositories[repository].candidate = {
    commit: candidate.commit,
    ref: candidate.candidateRef,
    paths: candidate.staged,
  };
  const timestamp = new Date().toISOString();
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'repository.candidate_recorded', actor: 'git-custodian',
    data: { repository, ...progress.repositories[repository].candidate },
  });
  writeProgressV2(file, progress);
  return progress;
}

// Record candidate identity before the commit is created. The immutable Git ref
// is the commit authority; persisting the resulting SHA after a docs commit
// would modify progress.json again and leave that worktree permanently dirty.
export function recordRepositoryCandidatePrepared(file, repository, candidate, { expectedRevision = null } = {}) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  if (!progress.repositories[repository]) throw new Error(`[cc-nexs] repository is not assigned: ${repository}`);
  progress.repositories[repository].candidate = {
    commit: null,
    ref: candidate.candidateRef,
    paths: candidate.staged,
  };
  const timestamp = new Date().toISOString();
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'repository.candidate_prepared', actor: 'git-custodian',
    data: { repository, ref: candidate.candidateRef, paths: candidate.staged },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function progressJsonForMarkdown(markdownPath) {
  return join(dirname(markdownPath), 'progress.json');
}

export function hasProgressV2(markdownPath) {
  return existsSync(progressJsonForMarkdown(markdownPath));
}
