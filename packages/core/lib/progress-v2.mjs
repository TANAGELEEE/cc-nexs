import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const PROGRESS_SCHEMA_VERSION = 2;

const TEST_RELEASE_INVALIDATION_STATES = new Set([
  'TEST_BLOCKED',
  'FINAL_QA_BLOCKED',
  'ACCEPTANCE_REJECTED',
  'FINAL_ACCEPTANCE_REJECTED',
  'HOTFIX_TEST_FAILED',
  'HOTFIX_CHANGE_REQUESTED',
]);

export function createProgressV2({
  featureId,
  featureSlug,
  preset,
  mode = 'lean',
  repositories = [],
  deliveryStrategy = 'final_only',
  testReleasePolicy = 'auto_if_ready',
}) {
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
    hotfix: null,
    gates: {
      g1: { approved: false },
      g2: { approved: false, sprints: {} },
      plan: { approved: false, binding: null },
      release: { approved: false, binding: null },
    },
    local_verification: { status: 'idle', context: null, candidate_fingerprint: null, attempts: [] },
    review: { status: 'idle', candidate_fingerprint: null, reviewed_commits: {}, blocking_findings: [], closure_attempts: 0, gateway_b_delta_attempts: 0 },
    change_requests: { current: null, items: [] },
    delivery: {
      strategy: deliveryStrategy,
      test: { policy: testReleasePolicy, status: 'idle', attempts: [] },
      base: { status: 'idle', attempts: [] },
    },
    repositories: Object.fromEntries(repositories.map((id) => [id, { branch: null, worktree: null, candidate: null }])),
    events: [],
  };
}

export function validateProgressV2(progress) {
  const errors = [];
  if (!progress || typeof progress !== 'object') errors.push('progress must be an object');
  if (progress?.schema_version !== PROGRESS_SCHEMA_VERSION) errors.push('schema_version must be 2');
  if (!progress?.feature?.id || !progress?.feature?.slug) errors.push('feature.id and feature.slug are required');
  if (!['lean', 'fast', 'full', 'hotfix', 'lite'].includes(progress?.mode)) errors.push('mode is invalid');
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
  if (progress?.delivery !== undefined) {
    if (!['final_only', 'per_sprint'].includes(progress.delivery?.strategy)) errors.push('delivery.strategy is invalid');
    if (!['auto_if_ready', 'manual', 'disabled'].includes(progress.delivery?.test?.policy)) errors.push('delivery.test.policy is invalid');
    if (!Array.isArray(progress.delivery?.test?.attempts)) errors.push('delivery.test.attempts must be an array');
    if (progress.delivery?.base !== undefined && !Array.isArray(progress.delivery.base?.attempts)) errors.push('delivery.base.attempts must be an array');
  }
  if (progress?.hotfix !== undefined && progress.hotfix !== null) {
    if (!['P0', 'P1', 'P2', 'P3'].includes(progress.hotfix?.severity)) errors.push('hotfix.severity is invalid');
    if (typeof progress.hotfix?.review_required !== 'boolean') errors.push('hotfix.review_required must be boolean');
    if (!progress.hotfix?.scope_binding?.hotfix_scope_sha256) errors.push('hotfix.scope_binding is required');
    if (progress.hotfix?.related_feature !== null && typeof progress.hotfix?.related_feature !== 'string') errors.push('hotfix.related_feature must be a string or null');
  }
  if (progress?.change_requests !== undefined) {
    if (!Array.isArray(progress.change_requests?.items)) errors.push('change_requests.items must be an array');
    if (progress.change_requests?.current !== null && typeof progress.change_requests?.current !== 'string') {
      errors.push('change_requests.current must be a string or null');
    }
    const ids = new Set();
    for (const request of progress.change_requests?.items || []) {
      if (!request?.id || ids.has(request.id)) errors.push('change request ids must be present and unique');
      ids.add(request?.id);
      if (!['evidence', 'implementation', 'scope'].includes(request?.kind)) errors.push(`change request ${request?.id || '<missing>'} kind is invalid`);
      if (typeof request?.feedback !== 'string' || !request.feedback) errors.push(`change request ${request?.id || '<missing>'} feedback is required`);
      if (!Array.isArray(request?.affected_acs) || !Array.isArray(request?.paths)) errors.push(`change request ${request?.id || '<missing>'} arrays are invalid`);
      if (!['recorded', 'open', 'addressed', 'approved'].includes(request?.status)) errors.push(`change request ${request?.id || '<missing>'} status is invalid`);
      if (typeof request?.requested_by !== 'string' || typeof request?.requested_at !== 'string') errors.push(`change request ${request?.id || '<missing>'} requester metadata is required`);
    }
    if (progress.change_requests?.current && !ids.has(progress.change_requests.current)) {
      errors.push('change_requests.current must reference an item');
    }
  }
  return errors;
}

function releaseFingerprint(source) {
  const normalized = Object.fromEntries(Object.entries(source || {}).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function requireDelivery(progress) {
  if (!progress.delivery) {
    progress.delivery = {
      strategy: 'per_sprint',
      test: { policy: 'manual', status: 'idle', attempts: [] },
    };
  }
  if (!progress.delivery.base) progress.delivery.base = { status: 'idle', attempts: [] };
  return progress.delivery;
}

function candidateFingerprint(source) {
  const normalized = Object.fromEntries(Object.entries(source || {}).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function assertCandidateMutationAllowed(progress) {
  if (progress.delivery?.test?.status === 'running') {
    throw new Error('[cc-nexs] cannot update a repository candidate while test release is running');
  }
}

function appendMutationEvent(progress, { type, actor, data }) {
  const timestamp = new Date().toISOString();
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type, actor, ...(data && { data }),
  });
  return timestamp;
}

export function beginTestRelease(file, {
  source,
  actor = 'release-controller',
  retry = false,
  expectedRevision = null,
} = {}) {
  if (!source || Object.keys(source).length === 0) throw new Error('[cc-nexs] test release source is required');
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  const testDelivery = requireDelivery(progress).test;
  const fingerprint = releaseFingerprint(source);
  const previous = testDelivery.attempts.at(-1);
  if (previous?.fingerprint === fingerprint) {
    if (['succeeded', 'verified'].includes(previous.status) || !retry) {
      return { progress, attempt: previous, reused: true };
    }
  }
  const round = testDelivery.attempts.length + 1;
  const attempt = {
    id: `test-release-${round}`,
    round,
    fingerprint,
    status: 'running',
    source,
    integrations: {},
    pipeline: null,
    deployment: null,
    environment_revision: null,
    verification: null,
    started_at: new Date().toISOString(),
    completed_at: null,
  };
  testDelivery.attempts.push(attempt);
  testDelivery.status = 'running';
  appendMutationEvent(progress, {
    type: 'delivery.test.started', actor, data: { attempt: attempt.id, round, fingerprint, source },
  });
  writeProgressV2(file, progress);
  return { progress, attempt, reused: false };
}

export function recordTestIntegration(file, {
  attemptId,
  repository,
  sourceCommit,
  targetBranch,
  targetBefore,
  integrationCommit,
  actor = 'git-custodian',
} = {}) {
  const progress = readProgressV2(file);
  const testDelivery = requireDelivery(progress).test;
  const attempt = testDelivery.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`[cc-nexs] unknown test release attempt: ${attemptId}`);
  attempt.integrations[repository] = { sourceCommit, targetBranch, targetBefore, integrationCommit };
  appendMutationEvent(progress, {
    type: 'delivery.test.repository_integrated', actor,
    data: { attempt: attemptId, repository, ...attempt.integrations[repository] },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function completeTestRelease(file, {
  attemptId,
  status,
  pipeline = null,
  deployment = null,
  environmentRevision = null,
  reason = '',
  actor = 'release-controller',
} = {}) {
  const allowed = new Set(['succeeded', 'failed', 'deployed_needs_manual_verification']);
  if (!allowed.has(status)) throw new Error(`[cc-nexs] invalid test release status: ${status}`);
  const progress = readProgressV2(file);
  const testDelivery = requireDelivery(progress).test;
  const attempt = testDelivery.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`[cc-nexs] unknown test release attempt: ${attemptId}`);
  attempt.status = status;
  attempt.pipeline = pipeline;
  attempt.deployment = deployment;
  attempt.environment_revision = environmentRevision;
  attempt.completed_at = new Date().toISOString();
  if (reason) attempt.reason = reason;
  testDelivery.status = status;
  appendMutationEvent(progress, {
    type: `delivery.test.${status}`, actor,
    data: { attempt: attemptId, ...(pipeline && { pipeline }), ...(deployment && { deployment }), ...(environmentRevision && { environment_revision: environmentRevision }), ...(reason && { reason }) },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function recordTestVerification(file, {
  attemptId,
  result,
  evidence = [],
  actor = 'verifier',
} = {}) {
  if (!['passed', 'blocked'].includes(result)) throw new Error(`[cc-nexs] invalid verification result: ${result}`);
  const progress = readProgressV2(file);
  const testDelivery = requireDelivery(progress).test;
  const attempt = testDelivery.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`[cc-nexs] unknown test release attempt: ${attemptId}`);
  const previousResult = attempt.verification?.result || null;
  attempt.verification = { result, evidence, recorded_at: new Date().toISOString() };
  if (result === 'passed') {
    attempt.status = 'verified';
    testDelivery.status = 'verified';
  } else if (progress.mode === 'hotfix' && previousResult !== 'blocked') {
    progress.counters.fix_per_bug ||= {};
    progress.counters.fix_per_bug.HOTFIX_TEST = (progress.counters.fix_per_bug.HOTFIX_TEST || 0) + 1;
  }
  appendMutationEvent(progress, {
    type: `delivery.test.verification_${result}`, actor,
    data: {
      attempt: attemptId,
      evidence,
      ...(progress.mode === 'hotfix' && result === 'blocked'
        ? {
            hotfix_test_failures: progress.counters.fix_per_bug.HOTFIX_TEST || 0,
            duplicate_attempt_result: previousResult === 'blocked',
          }
        : {}),
    },
  });
  writeProgressV2(file, progress);
  return progress;
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
  if (to !== null && TEST_RELEASE_INVALIDATION_STATES.has(to)) {
    const delivery = requireDelivery(progress);
    delivery.test.status = 'idle';
    progress.gates.g2 = {
      ...progress.gates.g2,
      approved: false,
      invalidated_at: timestamp,
    };
  }
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

export function approveProgressGate(file, { gate, approver, sprint = null, binding = null, expectedRevision = null }) {
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  if (!['g1', 'g2', 'plan', 'release'].includes(gate)) throw new Error(`[cc-nexs] unknown gate: ${gate}`);
  const timestamp = new Date().toISOString();
  if (gate === 'g2' && sprint !== null) {
    progress.gates.g2.sprints[String(sprint)] = { approved: true, approver, approved_at: timestamp };
  } else {
    progress.gates[gate] = { ...progress.gates[gate], approved: true, approver, approved_at: timestamp, ...(binding && { binding }) };
  }
  if (gate === 'release' && progress.change_requests?.current) {
    const current = progress.change_requests.items.find((item) => item.id === progress.change_requests.current);
    if (current) {
      current.status = 'approved';
      current.resolved_at = timestamp;
    }
    progress.change_requests.current = null;
  }
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp, type: 'gate.approved', actor: approver,
    data: { gate, ...(sprint !== null && { sprint }), ...(binding && { binding }) },
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
  assertCandidateMutationAllowed(progress);
  if (!progress.repositories[repository]) throw new Error(`[cc-nexs] repository is not assigned: ${repository}`);
  progress.repositories[repository].candidate = {
    commit: candidate.commit,
    ref: candidate.candidateRef,
    paths: candidate.staged,
  };
  invalidateLeanCandidateEvidence(progress);
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
  assertCandidateMutationAllowed(progress);
  if (!progress.repositories[repository]) throw new Error(`[cc-nexs] repository is not assigned: ${repository}`);
  progress.repositories[repository].candidate = {
    commit: null,
    ref: candidate.candidateRef,
    paths: candidate.staged,
  };
  invalidateLeanCandidateEvidence(progress);
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

function invalidateLeanCandidateEvidence(progress) {
  progress.local_verification = {
    status: 'idle',
    context: null,
    candidate_fingerprint: null,
    attempts: progress.local_verification?.attempts || [],
  };
  progress.review = {
    status: 'idle',
    candidate_fingerprint: null,
    reviewed_commits: {},
    blocking_findings: [],
    closure_attempts: progress.review?.closure_attempts || 0,
    gateway_b_delta_attempts: progress.review?.gateway_b_delta_attempts || 0,
  };
  if (progress.gates?.release) progress.gates.release = { approved: false, binding: null };
}

export function recordReleaseChangeRequest(file, {
  kind,
  feedback,
  affectedAcs = [],
  paths = [],
  actor = 'human',
  expectedRevision = null,
} = {}) {
  const allowedKinds = new Set(['evidence', 'implementation', 'scope']);
  if (!allowedKinds.has(kind)) throw new Error(`[cc-nexs] invalid Gateway B change kind: ${kind || '<missing>'}`);
  if (typeof feedback !== 'string' || !feedback.trim()) throw new Error('[cc-nexs] Gateway B feedback is required');
  if (!Array.isArray(affectedAcs) || affectedAcs.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('[cc-nexs] affected ACs must be non-empty strings');
  }
  if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('[cc-nexs] affected paths must be non-empty strings');
  }
  const progress = readProgressV2(file);
  if (!['lean', 'hotfix'].includes(progress.mode)) throw new Error(`[cc-nexs] release-gate changes require lean or hotfix mode, found ${progress.mode}`);
  const pendingState = progress.mode === 'hotfix' ? 'HOTFIX_RELEASE_PENDING_HUMAN' : 'RELEASE_PENDING_HUMAN';
  if (progress.state !== pendingState) {
    throw new Error(`[cc-nexs] release-gate changes require ${pendingState}, found ${progress.state}`);
  }
  if (progress.mode === 'hotfix' && kind === 'scope') {
    throw new Error('[cc-nexs] hotfix scope/contract feedback cannot expand the bound patch; initialize a new lean/full change');
  }
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  progress.change_requests ||= { current: null, items: [] };
  const timestamp = new Date().toISOString();
  if (progress.change_requests.current) {
    const previous = progress.change_requests.items.find((item) => item.id === progress.change_requests.current);
    if (previous && previous.status === 'open') {
      previous.status = 'addressed';
      previous.resolved_at = timestamp;
    }
  }
  const request = {
    id: `gateway-b-${progress.change_requests.items.length + 1}`,
    kind,
    feedback: feedback.trim(),
    affected_acs: [...affectedAcs],
    paths: [...paths],
    status: kind === 'evidence' ? 'recorded' : 'open',
    requested_by: actor,
    requested_at: timestamp,
  };
  progress.change_requests.items.push(request);
  progress.change_requests.current = kind === 'evidence' ? null : request.id;

  if (kind === 'implementation') {
    invalidateLeanCandidateEvidence(progress);
    requireDelivery(progress).test.status = 'idle';
    progress.state = progress.mode === 'hotfix' ? 'HOTFIX_CHANGE_REQUESTED' : 'GATEWAY_B_CHANGE_REQUESTED';
  } else if (kind === 'scope') {
    invalidateLeanCandidateEvidence(progress);
    requireDelivery(progress).test.status = 'idle';
    progress.gates.plan = { approved: false, binding: null, invalidated_at: timestamp, reason: request.id };
    progress.state = 'SCOPE_CHANGE_REQUESTED';
  }

  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(),
    sequence: progress.revision,
    timestamp,
    type: `gate.release.change_requested.${kind}`,
    actor,
    from: pendingState,
    to: progress.state,
    data: request,
  });
  writeProgressV2(file, progress);
  return { progress, request };
}

export function recordLocalVerification(file, {
  source,
  status,
  context = null,
  evidence = [],
  actor = 'local-verifier',
  expectedRevision = null,
} = {}) {
  if (!['passed', 'failed'].includes(status)) throw new Error(`[cc-nexs] invalid local verification status: ${status}`);
  if (!source || Object.keys(source).length === 0) throw new Error('[cc-nexs] local verification source is required');
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  const fingerprint = candidateFingerprint(source);
  const allowedContexts = new Set([null, 'implementation', 'review', 'test', 'gateway_b', 'hotfix_fix']);
  if (!allowedContexts.has(context)) throw new Error(`[cc-nexs] invalid local verification context: ${context}`);
  const attempt = {
    id: `local-verify-${(progress.local_verification?.attempts?.length || 0) + 1}`,
    status,
    context,
    fingerprint,
    source,
    evidence,
    completed_at: new Date().toISOString(),
  };
  progress.local_verification ||= { status: 'idle', context: null, candidate_fingerprint: null, attempts: [] };
  progress.local_verification.status = status;
  progress.local_verification.context = context;
  progress.local_verification.candidate_fingerprint = fingerprint;
  progress.local_verification.attempts.push(attempt);
  if (status === 'failed') {
    progress.review = {
      status: 'idle',
      candidate_fingerprint: null,
      reviewed_commits: {},
      blocking_findings: [],
      closure_attempts: progress.review?.closure_attempts || 0,
      gateway_b_delta_attempts: progress.review?.gateway_b_delta_attempts || 0,
    };
  }
  appendMutationEvent(progress, { type: `local_verification.${status}`, actor, data: attempt });
  writeProgressV2(file, progress);
  return progress;
}

export function recordHotfixBoundaryEvidence(file, {
  source,
  boundary,
  actor = 'hotfix-boundary-controller',
  expectedRevision = null,
} = {}) {
  if (!source || Object.keys(source).length === 0) throw new Error('[cc-nexs] P3 boundary source is required');
  if (boundary?.files !== 1 || !Number.isInteger(boundary?.lines) || boundary.lines < 0 || boundary.lines > 20) {
    throw new Error('[cc-nexs] invalid P3 boundary evidence');
  }
  const progress = readProgressV2(file);
  if (progress.mode !== 'hotfix' || progress.hotfix?.severity !== 'P3') {
    throw new Error('[cc-nexs] P3 boundary evidence requires a P3 hotfix');
  }
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  const fingerprint = candidateFingerprint(source);
  const attempt = progress.local_verification?.attempts?.findLast((item) => item.status === 'passed' && item.fingerprint === fingerprint);
  if (progress.local_verification?.status !== 'passed' || progress.local_verification.candidate_fingerprint !== fingerprint || !attempt) {
    throw new Error('[cc-nexs] P3 boundary evidence requires passed local verification for the exact candidate');
  }
  const evidence = { type: 'p3_boundary', ...boundary, recorded_at: new Date().toISOString() };
  attempt.evidence = [...(attempt.evidence || []).filter((item) => item?.type !== 'p3_boundary'), evidence];
  appendMutationEvent(progress, { type: 'hotfix.p3_boundary_passed', actor, data: { fingerprint, boundary } });
  writeProgressV2(file, progress);
  return progress;
}

export function recordConsolidatedReview(file, {
  source,
  status,
  blockingFindings = [],
  closure = false,
  gatewayBDelta = false,
  actor = 'lean-reviewer',
  expectedRevision = null,
} = {}) {
  if (closure && gatewayBDelta) throw new Error('[cc-nexs] Review cannot be both closure and Gateway B delta');
  if (!['passed', 'blocked'].includes(status)) throw new Error(`[cc-nexs] invalid review status: ${status}`);
  if (!source || Object.keys(source).length === 0) throw new Error('[cc-nexs] review source is required');
  if (!Array.isArray(blockingFindings) || blockingFindings.some((item) => typeof item !== 'string' || !/^P[01]\b/.test(item))) {
    throw new Error('[cc-nexs] blocking Review findings must be P0/P1 strings');
  }
  if (status === 'blocked' && blockingFindings.length === 0) {
    throw new Error('[cc-nexs] a blocked Review requires at least one P0/P1 finding');
  }
  if (status === 'passed' && blockingFindings.length > 0) {
    throw new Error('[cc-nexs] a passing Review cannot contain blocking findings');
  }
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  const fingerprint = candidateFingerprint(source);
  if (progress.local_verification?.status !== 'passed' || progress.local_verification.candidate_fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] consolidated review requires local verification for the same candidate');
  }
  progress.review = {
    status,
    candidate_fingerprint: fingerprint,
    reviewed_commits: source,
    blocking_findings: blockingFindings,
    closure_attempts: (progress.review?.closure_attempts || 0) + (closure ? 1 : 0),
    gateway_b_delta_attempts: (progress.review?.gateway_b_delta_attempts || 0) + (gatewayBDelta ? 1 : 0),
    reviewed_at: new Date().toISOString(),
  };
  appendMutationEvent(progress, {
    type: gatewayBDelta
      ? `review.gateway_b_delta_${status}`
      : closure ? `review.closure_${status}` : `review.consolidated_${status}`,
    actor,
    data: { fingerprint, source, blocking_findings: blockingFindings },
  });
  writeProgressV2(file, progress);
  return progress;
}

export function beginBaseRelease(file, { source, actor = 'base-release-controller', expectedRevision = null } = {}) {
  if (!source || Object.keys(source).length === 0) throw new Error('[cc-nexs] base release source is required');
  const progress = readProgressV2(file);
  if (expectedRevision !== null && progress.revision !== expectedRevision) {
    throw new Error(`[cc-nexs] stale progress revision: expected ${expectedRevision}, found ${progress.revision}`);
  }
  const delivery = requireDelivery(progress);
  const attempt = {
    id: `base-release-${delivery.base.attempts.length + 1}`,
    status: 'running',
    fingerprint: candidateFingerprint(source),
    source,
    integrations: {},
    started_at: new Date().toISOString(),
    completed_at: null,
  };
  delivery.base.attempts.push(attempt);
  delivery.base.status = 'running';
  appendMutationEvent(progress, { type: 'delivery.base.started', actor, data: attempt });
  writeProgressV2(file, progress);
  return attempt;
}

export function recordBaseIntegration(file, { attemptId, repository, integration, actor = 'git-custodian' } = {}) {
  const progress = readProgressV2(file);
  const attempt = requireDelivery(progress).base.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`[cc-nexs] unknown base release attempt: ${attemptId}`);
  attempt.integrations[repository] = integration;
  appendMutationEvent(progress, { type: 'delivery.base.repository_integrated', actor, data: { attempt: attemptId, repository, ...integration } });
  writeProgressV2(file, progress);
  return progress;
}

export function completeBaseRelease(file, { attemptId, status, reason = '', actor = 'base-release-controller' } = {}) {
  if (!['succeeded', 'failed'].includes(status)) throw new Error(`[cc-nexs] invalid base release status: ${status}`);
  const progress = readProgressV2(file);
  const delivery = requireDelivery(progress);
  const attempt = delivery.base.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`[cc-nexs] unknown base release attempt: ${attemptId}`);
  attempt.status = status;
  attempt.reason = reason;
  attempt.completed_at = new Date().toISOString();
  delivery.base.status = status;
  appendMutationEvent(progress, { type: `delivery.base.${status}`, actor, data: { attempt: attemptId, reason } });
  writeProgressV2(file, progress);
  return progress;
}

export { candidateFingerprint };

export function progressJsonForMarkdown(markdownPath) {
  return join(dirname(markdownPath), 'progress.json');
}

export function hasProgressV2(markdownPath) {
  return existsSync(progressJsonForMarkdown(markdownPath));
}
