import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { jsonValuesEqual } from './canonical-json.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { integrateCandidateToTest, resolveCandidateCommit } from './git-custodian.mjs';
import { approvedPlanDeliveryContract } from './plan-contract.mjs';
import {
  beginTestRelease,
  completeTestRelease,
  readProgressV2,
  recordTestIntegration,
  reopenTestRelease,
} from './progress-v2.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';

const DRIVER_STATUSES = new Set(['pending', 'succeeded', 'failed', 'deployed_needs_manual_verification']);

export function preflightTestRelease({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  manual = false,
  hotfix = false,
  retry = false,
  verification = false,
} = {}) {
  if (!featureId) throw new Error('feature id is required');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const workspaceRoot = findWorkspaceRoot(cwd, progressFile);
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  if (!workspace) throw new Error('[cc-nexs] workspace config is required for automatic test release');
  const pluginRoot = process.env.CC_NEXS_PLUGIN_ROOT
    || process.env.CLAUDE_PLUGIN_ROOT
    || process.env.CODEX_PLUGIN_ROOT
    || process.env.PLUGIN_ROOT
    || null;
  const config = loadConfig({ projectRoot: workspaceRoot, ...(pluginRoot && { presetRoot: pluginRoot }) });
  const progress = readProgressV2(progressFile);
  const planDelivery = progress.mode === 'lean'
    ? approvedPlanDeliveryContract(progress, dirname(progressFile))
    : { version: 0, lane: 'standard', repositories: {} };
  const featureConfig = readFeatureConfig(progressFile);
  rejectPlaintextCredentials({ project: config.project, overlay: config.overlay, feature: featureConfig });
  if (!verification) {
    const configuredOverride = config.project?.workflow?.test_release?.policy
      ?? config.overlay?.workflow?.test_release?.policy;
    const policy = resolveTestReleasePolicy({
      progress,
      featureConfig,
      configured: config.mergedWorkflow?.test_release?.policy,
      configuredOverride,
      manual,
    });
    if (policy !== 'auto_if_ready') throw new Error(`[cc-nexs] automatic test release is ${policy}`);
  }
  if (hotfix) {
    if (progress.mode !== 'hotfix') throw new Error(`[cc-nexs] --hotfix requires mode hotfix, found ${progress.mode}`);
    const allowedStates = verification
      ? ['HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_VERIFYING', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY']
      : retry ? ['HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_RELEASE_BLOCKED'] : ['HOTFIX_TEST_RELEASE'];
    if (!allowedStates.includes(progress.state)) {
      throw new Error(`[cc-nexs] hotfix test release requires HOTFIX_TEST_RELEASE readiness, found ${progress.state}`);
    }
    assertHotfixScopeCurrent(progress, dirname(progressFile));
  } else if (progress.mode === 'hotfix') {
    throw new Error('[cc-nexs] hotfix test release requires the explicit --hotfix control');
  } else if (!(verification
    ? ['TEST_RELEASE', 'TEST_VERIFYING', 'TEST', 'REGRESSION', 'FINAL_QA', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'].includes(progress.state)
    : (retry ? ['TEST_RELEASE', 'TEST_RELEASE_BLOCKED'] : ['TEST_RELEASE']).includes(progress.state))) {
    throw new Error(`[cc-nexs] test release requires TEST_RELEASE readiness, found ${progress.state}`);
  }

  const workspaceById = new Map(workspace.repositories.map((repo) => [repo.id, repo]));
  const docsRepositories = new Set(workspace.repositories
    .filter((repo) => repo.docs === true || repo.id === workspace.docs_repository)
    .map((repo) => repo.id));
  const assignedRepositoryIds = Object.entries(progress.repositories || {})
    .filter(([, assignment]) => assignment && (assignment.branch || assignment.worktree || assignment.candidate))
    .map(([id]) => id);
  for (const id of assignedRepositoryIds) {
    if (!workspaceById.has(id)) throw new Error(`[cc-nexs] assigned repository is missing from workspace config: ${id}`);
  }

  const repositories = assignedRepositoryIds
    .filter((id) => !docsRepositories.has(id))
    .map((id) => {
      const repo = workspaceById.get(id);
      const assignment = progress.repositories[id];
      if (!assignment?.candidate?.ref) {
        throw new Error(`[cc-nexs] assigned repository ${repo.id} is missing a candidate ref`);
      }
      const sourceCommit = resolveCandidateCommit({ repo: repo.absolute_path, candidateRef: assignment.candidate.ref });
      const requestedDelivery = progress.mode === 'lean'
        ? planDelivery.repositories[repo.id] || (planDelivery.version === 0 ? 'deploy' : null)
        : 'deploy';
      if (!requestedDelivery) {
        throw new Error(`[cc-nexs] approved plan is missing test_delivery.${repo.id}: deploy|local`);
      }
      if (requestedDelivery === 'deploy' && !repo.test_branch) {
        throw new Error(`[cc-nexs] repository ${repo.id} is marked deploy but has no test_branch; set test_delivery.${repo.id}: local in the approved plan only when it will run locally`);
      }
      const approvedTestTarget = requestedDelivery === 'deploy' && planDelivery.version >= 2
        ? planDelivery.targets[repo.id]
        : repo.test_branch;
      if (requestedDelivery === 'deploy' && planDelivery.version >= 2) {
        if (typeof approvedTestTarget !== 'string' || !approvedTestTarget.trim()) {
          throw new Error(`[cc-nexs] Gateway A test target binding is missing for ${repo.id}; re-run approve-plan to bind the deploy target`);
        }
        if (repo.test_branch !== approvedTestTarget) {
          throw new Error(`[cc-nexs] workspace test branch changed after Gateway A for ${repo.id}: approved ${approvedTestTarget}, current ${repo.test_branch}`);
        }
      }
      const worktree = assignment.worktree ? resolve(workspaceRoot, assignment.worktree) : null;
      if (requestedDelivery === 'local') assertLocalCandidateWorktree({
        repository: repo.id,
        worktree,
        branch: assignment.branch,
        sourceCommit,
      });
      return {
        id: repo.id,
        repo: repo.absolute_path,
        candidateRef: assignment.candidate.ref,
        sourceCommit,
        delivery: requestedDelivery === 'local' ? 'local' : 'test_branch',
        targetBranch: requestedDelivery === 'local' ? null : approvedTestTarget,
        worktree,
        releaseOrder: repo.release_order,
      };
    })
    .sort((left, right) => left.releaseOrder - right.releaseOrder || left.id.localeCompare(right.id));
  if (repositories.length === 0) throw new Error('[cc-nexs] no code repository candidate is ready for test release');
  const deployRepositories = repositories.filter((repository) => repository.delivery === 'test_branch');
  const localRepositories = repositories.filter((repository) => repository.delivery === 'local');
  if (deployRepositories.length === 0) {
    throw new Error('[cc-nexs] automatic test release requires at least one candidate repository with test_branch');
  }
  if (progress.mode === 'lean' && planDelivery.version >= 2) {
    const expectedTargets = deployRepositories.map((repository) => repository.id).sort();
    const boundTargets = Object.keys(planDelivery.targets || {}).sort();
    if (JSON.stringify(boundTargets) !== JSON.stringify(expectedTargets)) {
      throw new Error('[cc-nexs] Gateway A test target repository set no longer matches the approved deploy topology');
    }
  }
  const source = Object.fromEntries(repositories.map((repo) => [repo.id, repo.sourceCommit]));
  if (hotfix) assertHotfixReleaseEvidence(progress, source);
  else if (progress.mode === 'lean') assertLeanReleaseEvidence(progress, source, planDelivery.lane);

  const release = config.mergedRelease?.test || {};
  if ((release.environment || 'test').toLowerCase() !== 'test') {
    throw new Error('[cc-nexs] automatic release environment must be test');
  }
  rejectProductionVerificationUrls(release);
  const driver = normalizeDriver(release.driver, workspaceRoot);
  if (!verification && !driver) throw new Error('[cc-nexs] release.test.driver is required for auto_if_ready');

  return {
    progressFile,
    workspaceRoot,
    workspace,
    progress,
    release,
    driver,
    repositories,
    deployRepositories,
    localRepositories,
    source,
  };
}

function assertLeanReleaseEvidence(progress, source, lane) {
  const fingerprint = releaseFingerprint(source);
  if (!['passed', 'deferred_to_test'].includes(progress.local_verification?.status)
    || progress.local_verification.candidate_fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] Lean test release requires passed or test-deferred local verification for the exact candidate');
  }
  if (lane !== 'fast-track'
    && (progress.review?.status !== 'passed' || progress.review.candidate_fingerprint !== fingerprint)) {
    throw new Error('[cc-nexs] standard Lean test release requires a passing Review for the exact candidate');
  }
}

function assertHotfixReleaseEvidence(progress, source) {
  const fingerprint = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  if (progress.local_verification?.status !== 'passed' || progress.local_verification.candidate_fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] hotfix test release requires local verification for the exact candidate');
  }
  if (progress.hotfix?.severity === 'P3') {
    const localAttempt = progress.local_verification.attempts?.findLast((item) => item.status === 'passed' && item.fingerprint === fingerprint);
    if (!localAttempt?.evidence?.some((item) => item?.type === 'p3_boundary' && item.files === 1 && item.lines <= 20)) {
      throw new Error('[cc-nexs] P3 test release requires deterministic one-file/20-line boundary evidence');
    }
  } else if (progress.review?.status !== 'passed' || progress.review.candidate_fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] hotfix test release requires one passing Review for the exact candidate');
  }
}

export function runTestRelease({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  retry = false,
  dryRun = false,
  hotfix = false,
  resume = false,
  capabilityAttested: _capabilityAttested = false,
} = {}) {
  let context = preflightTestRelease({ cwd, featureId, progressPath, hotfix, retry });
  if (dryRun) return { kind: 'test-release', dryRun: true, ...summary(context) };

  const releaseLock = acquireTestReleaseLock(context.progressFile, { allowStaleRecovery: retry || resume });
  try {
    context = preflightTestRelease({ cwd, featureId, progressPath, hotfix, retry });
    const blockedState = hotfix ? 'HOTFIX_TEST_RELEASE_BLOCKED' : 'TEST_RELEASE_BLOCKED';
    if (retry && context.progress.state === blockedState) {
      reopenTestRelease(context.progressFile, { expectedRevision: context.progress.revision });
      context = preflightTestRelease({ cwd, featureId, progressPath, hotfix });
    }
    if (resume) return resumeTestRelease(context);
    const started = beginTestRelease(context.progressFile, {
      source: context.source,
      retry,
      expectedRevision: context.progress.revision,
    });
    if (started.reused && ['deploying', 'succeeded', 'verified'].includes(started.attempt.status)) {
      return { kind: 'test-release', reused: true, attempt: started.attempt, ...summary(context) };
    }
    if (started.reused && started.attempt.status === 'running') {
      throw new Error('[cc-nexs] previous test release is still running; use --retry only after confirming the prior controller stopped');
    }
    if (started.reused && started.attempt.status === 'failed') {
      throw new Error('[cc-nexs] previous test release failed; pass --retry after resolving the cause');
    }
    if (started.reused) {
      throw new Error(`[cc-nexs] previous test release requires explicit handling: ${started.attempt.status}`);
    }
    const attemptId = started.attempt.id;
    try {
      integratePendingRepositories(context, attemptId);

      const current = readProgressV2(context.progressFile);
      const attempt = current.delivery.test.attempts.find((item) => item.id === attemptId);
      const driverResult = invokeDriver(context, attempt, 'release_test');
      persistDriverResult(context.progressFile, attempt, driverResult);
      return {
        kind: 'test-release',
        reused: false,
        attempt: readProgressV2(context.progressFile).delivery.test.attempts.find((item) => item.id === attemptId),
        ...summary(context),
      };
    } catch (error) {
      const latest = readProgressV2(context.progressFile);
      const attempt = latest.delivery.test.attempts.find((item) => item.id === attemptId);
      if (attempt && attempt.status === 'running') {
        completeTestRelease(context.progressFile, {
          attemptId,
          status: 'failed',
          reason: error.message,
          expectedRevision: latest.revision,
        });
      }
      throw error;
    }
  } finally {
    releaseLock();
  }
}

function resumeTestRelease(context) {
  let attempt = context.progress.delivery?.test?.attempts?.at(-1);
  if (!attempt || attempt.fingerprint !== releaseFingerprint(context.source)) {
    throw new Error('[cc-nexs] --resume requires the current exact-candidate test release attempt');
  }
  if (!['running', 'deploying'].includes(attempt.status)) {
    if (['succeeded', 'verified'].includes(attempt.status)) {
      return { kind: 'test-release', reused: true, attempt, ...summary(context) };
    }
    throw new Error(`[cc-nexs] --resume requires a running or deploying attempt, found ${attempt.status}`);
  }
  if (attempt.status === 'running') {
    integratePendingRepositories(context, attempt.id);
    attempt = readProgressV2(context.progressFile).delivery.test.attempts.at(-1);
  }
  const driverResult = invokeDriver(context, attempt, 'release_test_status');
  persistDriverResult(context.progressFile, attempt, driverResult);
  return {
    kind: 'test-release',
    reused: true,
    attempt: readProgressV2(context.progressFile).delivery.test.attempts.find((item) => item.id === attempt.id),
    ...summary(context),
  };
}

function integratePendingRepositories(context, attemptId) {
  let progress = readProgressV2(context.progressFile);
  for (const repository of context.deployRepositories) {
    const existing = progress.delivery.test.attempts
      .find((attempt) => attempt.id === attemptId)?.integrations?.[repository.id];
    if (existing) {
      if (existing.sourceCommit !== repository.sourceCommit || existing.targetBranch !== repository.targetBranch) {
        throw new Error(`[cc-nexs] recorded test integration does not match the bound candidate for ${repository.id}`);
      }
      continue;
    }
    const result = integrateCandidateToTest({
      repo: repository.repo,
      repositoryId: repository.id,
      candidateRef: repository.candidateRef,
      expectedSourceCommit: repository.sourceCommit,
      targetBranch: repository.targetBranch,
    });
    recordTestIntegration(context.progressFile, {
      attemptId,
      repository: repository.id,
      sourceCommit: result.sourceCommit,
      targetBranch: result.targetBranch,
      targetBefore: result.targetBefore,
      integrationCommit: result.remoteCommit || result.integrationCommit,
    });
    progress = readProgressV2(context.progressFile);
  }
}

function persistDriverResult(progressFile, attempt, driverResult) {
  const latest = readProgressV2(progressFile);
  const currentAttempt = latest.delivery?.test?.attempts?.at(-1);
  if (!currentAttempt || currentAttempt.id !== attempt.id || currentAttempt.fingerprint !== attempt.fingerprint) {
    throw new Error('[cc-nexs] test release attempt changed before driver evidence could be recorded');
  }
  completeTestRelease(progressFile, {
    attemptId: attempt.id,
    status: driverResult.status === 'pending' ? 'deploying' : driverResult.status,
    pipeline: driverResult.pipeline || currentAttempt.pipeline || null,
    deployment: driverResult.deployment || currentAttempt.deployment || null,
    environmentRevision: driverResult.environment_revision || currentAttempt.environment_revision || null,
    reason: driverResult.reason || '',
    expectedRevision: latest.revision,
  });
}

export function acquireTestReleaseLock(progressFile, { allowStaleRecovery = false } = {}) {
  const lockPath = join(dirname(progressFile), `.${basename(progressFile)}.test-release.lock`);
  const ownerPath = join(lockPath, 'owner.json');
  const token = randomUUID();
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    writeFileSync(ownerPath, `${JSON.stringify({ token, pid: process.pid, hostname: hostname(), started_at: new Date().toISOString() })}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      if (allowStaleRecovery && removeStaleReleaseLock(lockPath, ownerPath)) {
        return acquireTestReleaseLock(progressFile);
      }
      throw new Error(`[cc-nexs] another test release controller holds ${lockPath}`);
    }
    rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
  return () => {
    try {
      const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
      if (owner.token === token) rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // A missing or replaced lock is not ours to remove.
    }
  };
}

function removeStaleReleaseLock(lockPath, ownerPath) {
  let owner;
  try { owner = JSON.parse(readFileSync(ownerPath, 'utf8')); }
  catch { return false; }
  if (owner.hostname !== hostname() || !Number.isInteger(owner.pid)) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error.code !== 'ESRCH') return false;
  }
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

function invokeDriver(context, attempt, operation) {
  const payload = {
    schema_version: 1,
    operation,
    feature: context.progress.feature,
    environment: context.release.environment || 'test',
    attempt: attempt.id,
    integrations: attempt.integrations,
    candidates: attempt.source,
    local_candidates: Object.fromEntries(context.localRepositories.map((repository) => [repository.id, {
      commit: repository.sourceCommit,
      worktree: repository.worktree,
    }])),
    previous: {
      status: attempt.status,
      pipeline: attempt.pipeline,
      deployment: attempt.deployment,
      environment_revision: attempt.environment_revision,
    },
    endpoints: {
      app_url: context.release.app_url || null,
      operations_url: context.release.operations_url || null,
    },
    credential_ref: context.release.credential_ref || null,
  };
  return invokeTestReleaseDriver({
    driver: context.driver,
    workspaceRoot: context.workspaceRoot,
    payload,
  });
}

export function invokeTestReleaseDriver({ driver, workspaceRoot, payload }) {
  let output;
  try {
    output = execFileSync(driver.command, driver.args, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      input: `${JSON.stringify(payload)}\n`,
      timeout: driver.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CC_NEXS_RELEASE_ATTEMPT: payload.attempt, CC_NEXS_RELEASE_ENVIRONMENT: payload.environment },
    }).trim();
  } catch (error) {
    throw new Error(`[cc-nexs] test release driver failed: ${error.stderr?.toString().trim() || error.message}`);
  }
  let result;
  try { result = JSON.parse(output); }
  catch { throw new Error('[cc-nexs] test release driver must write one JSON object to stdout'); }
  if (!DRIVER_STATUSES.has(result?.status)) {
    throw new Error(`[cc-nexs] invalid test release driver status: ${result?.status || '<missing>'}`);
  }
  const effectivePipeline = result.pipeline || payload.previous?.pipeline;
  const effectiveDeployment = result.deployment || payload.previous?.deployment;
  const effectiveEnvironmentRevision = result.environment_revision || payload.previous?.environment_revision;
  if (payload.previous?.pipeline && result.pipeline
    && !jsonValuesEqual(payload.previous.pipeline, result.pipeline)) {
    throw new Error('[cc-nexs] release driver changed pipeline identity while resuming');
  }
  if (payload.operation === 'release_test_status' && !payload.previous?.pipeline
    && ['pending', 'succeeded', 'deployed_needs_manual_verification'].includes(result.status)
    && !isNonEmptyRecord(result.pipeline)) {
    throw new Error('[cc-nexs] release_test_status recovery must discover and return pipeline evidence for the existing attempt');
  }
  if (result.status === 'pending' && !isNonEmptyRecord(effectivePipeline)) {
    throw new Error('[cc-nexs] pending release driver output requires pipeline evidence');
  }
  if (['succeeded', 'deployed_needs_manual_verification'].includes(result.status)
    && (!isNonEmptyRecord(effectivePipeline)
      || !isNonEmptyRecord(effectiveDeployment)
      || !isNonEmptyRecord(effectiveEnvironmentRevision))) {
    throw new Error(`[cc-nexs] ${result.status} release driver output requires pipeline, deployment, and environment_revision evidence`);
  }
  if (['succeeded', 'deployed_needs_manual_verification'].includes(result.status)
    && String(effectiveDeployment.environment || '').toLowerCase() !== String(payload.environment || 'test').toLowerCase()) {
    throw new Error('[cc-nexs] release driver deployment evidence does not match the requested test environment');
  }
  if (['succeeded', 'deployed_needs_manual_verification'].includes(result.status)) {
    for (const [repository, integration] of Object.entries(payload.integrations || {})) {
      if (effectiveEnvironmentRevision[repository] !== integration.integrationCommit) {
        throw new Error(`[cc-nexs] release driver environment_revision for ${repository} does not match the integrated commit`);
      }
    }
  }
  return result;
}

function isNonEmptyRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function normalizeDriver(driver, workspaceRoot) {
  if (!driver || typeof driver !== 'object' || !driver.command) return null;
  const command = isAbsolute(driver.command)
    ? driver.command
    : driver.command.startsWith('.') || driver.command.includes('/')
      ? resolve(workspaceRoot, driver.command)
      : driver.command;
  if (isAbsolute(command) && !existsSync(command)) throw new Error(`[cc-nexs] release driver command not found: ${command}`);
  const timeoutSeconds = Number(driver.timeout_seconds || 1800);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error('[cc-nexs] release driver timeout_seconds must be a positive number');
  }
  return {
    command,
    args: Array.isArray(driver.args) ? driver.args.map(String) : [],
    timeoutMs: timeoutSeconds * 1000,
  };
}

function rejectProductionVerificationUrls(release) {
  for (const [name, value] of [['app_url', release.app_url], ['operations_url', release.operations_url]]) {
    if (!value) continue;
    let url;
    try { url = new URL(value); } catch { continue; }
    if (/(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) throw new Error(`[cc-nexs] production-like host is forbidden for automatic test release: ${url.hostname}`);
  }
}

function assertLocalCandidateWorktree({ repository, worktree, branch, sourceCommit }) {
  if (!worktree || !existsSync(worktree)) {
    throw new Error(`[cc-nexs] local test candidate ${repository} requires its assigned worktree`);
  }
  let head;
  let dirty;
  let actualBranch;
  let topLevel;
  try {
    head = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    actualBranch = execFileSync('git', ['-C', worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
    topLevel = execFileSync('git', ['-C', worktree, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', worktree, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`[cc-nexs] cannot inspect local test candidate ${repository}: ${error.message}`);
  }
  if (realpathSync(topLevel) !== realpathSync(worktree) || actualBranch !== branch || head !== sourceCommit || dirty) {
    throw new Error(`[cc-nexs] local test candidate ${repository} worktree must be clean at exact candidate ${sourceCommit}`);
  }
}

function rejectPlaintextCredentials(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (isSensitiveCredentialKey(key) && hasLiteralCredentialValue(child)) {
      throw new Error(`[cc-nexs] plaintext credential field is forbidden: ${next}`);
    }
    rejectPlaintextCredentials(child, next);
  }
}

function isSensitiveCredentialKey(key) {
  return /^(?:password|passwd|credential|credentials|secret_value|token|api_?key|secret|client_secret|access_key_id|secret_access_key|aws_access_key_id|aws_secret_access_key|private_key)$/i.test(key)
    && !/(?:_ref|_env|_file|_path)$/i.test(key);
}

function hasLiteralCredentialValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return false;
  return value !== undefined && value !== null && value !== '' && value !== false;
}

export function resolveTestReleasePolicy({ progress, featureConfig, configured, configuredOverride, manual = false }) {
  if (manual) return 'manual';
  const override = featureConfig?.release?.test;
  if (override && override !== 'inherit') return override === 'auto' ? 'auto_if_ready' : override;
  if (!progress.delivery) return 'manual';
  if (configuredOverride) return configuredOverride === 'auto' ? 'auto_if_ready' : configuredOverride;
  return progress.delivery.test?.policy || configured || 'manual';
}

function readFeatureConfig(progressFile) {
  const file = join(dirname(progressFile), 'config.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`[cc-nexs] invalid feature config: ${file}`); }
}

function releaseFingerprint(source) {
  const normalized = Object.fromEntries(Object.entries(source || {}).sort(([left], [right]) => left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function findWorkspaceRoot(cwd, progressFile) {
  for (const start of [resolve(cwd), dirname(progressFile)]) {
    let current = start;
    while (true) {
      if (existsSync(join(current, '.cc-nexs', 'workspace.yml')) || existsSync(join(current, '.cc-nexs', 'workspace.json'))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`[cc-nexs] workspace root not found from ${cwd}`);
}

function summary(context) {
  return {
    feature: context.progress.feature,
    progressFile: context.progressFile,
    repositories: context.repositories.map(({ id, sourceCommit, delivery, targetBranch, worktree }) => ({
      id,
      sourceCommit,
      delivery,
      targetBranch,
      ...(delivery === 'local' && { worktree }),
    })),
    environment: context.release.environment || 'test',
    verificationPrerequisites: inspectVerificationPrerequisites(context.release),
  };
}

function inspectVerificationPrerequisites(release) {
  const missing = [];
  const allowed = new Set(release.allowed_hosts || []);
  for (const [name, value] of [['app_url', release.app_url], ['operations_url', release.operations_url]]) {
    if (!value) { missing.push(`release.test.${name}`); continue; }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) missing.push(`${name}:https`);
      if (!allowed.has(url.hostname)) missing.push(`allowed_hosts:${url.hostname}`);
    } catch {
      missing.push(`${name}:valid_url`);
    }
  }
  return { ready: missing.length === 0, missing };
}
