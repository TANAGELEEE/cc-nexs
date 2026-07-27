import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { integrateCandidateToTest, resolveCandidateCommit } from './git-custodian.mjs';
import {
  beginTestRelease,
  completeTestRelease,
  readProgressV2,
  recordTestIntegration,
} from './progress-v2.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';

const TERMINAL_DRIVER_STATUSES = new Set(['succeeded', 'failed', 'deployed_needs_manual_verification']);

export function preflightTestRelease({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  manual = false,
  hotfix = false,
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
  const featureConfig = readFeatureConfig(progressFile);
  rejectPlaintextCredentials({ project: config.project, overlay: config.overlay, feature: featureConfig });
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
  if (!hotfix && progress.state !== 'TEST_RELEASE') {
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
      if (!repo.test_branch) throw new Error(`[cc-nexs] repository ${repo.id} is missing test_branch`);
      const sourceCommit = resolveCandidateCommit({ repo: repo.absolute_path, candidateRef: assignment.candidate.ref });
      return {
        id: repo.id,
        repo: repo.absolute_path,
        candidateRef: assignment.candidate.ref,
        sourceCommit,
        targetBranch: repo.test_branch,
        releaseOrder: repo.release_order,
      };
    })
    .sort((left, right) => left.releaseOrder - right.releaseOrder || left.id.localeCompare(right.id));
  if (repositories.length === 0) throw new Error('[cc-nexs] no code repository candidate is ready for test release');

  const release = config.mergedRelease?.test || {};
  if ((release.environment || 'test').toLowerCase() !== 'test') {
    throw new Error('[cc-nexs] automatic release environment must be test');
  }
  validateReleaseUrls(release);
  const driver = normalizeDriver(release.driver, workspaceRoot);
  if (!driver) throw new Error('[cc-nexs] release.test.driver is required for auto_if_ready');

  return {
    progressFile,
    workspaceRoot,
    workspace,
    progress,
    release,
    driver,
    repositories,
    source: Object.fromEntries(repositories.map((repo) => [repo.id, repo.sourceCommit])),
  };
}

export function runTestRelease({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  retry = false,
  dryRun = false,
  hotfix = false,
  capabilityAttested = false,
} = {}) {
  const context = preflightTestRelease({ cwd, featureId, progressPath, hotfix });
  if (dryRun) return { kind: 'test-release', dryRun: true, ...summary(context) };
  if (context.release.browser?.required !== false && !capabilityAttested) {
    throw new Error('[cc-nexs] browser capability preflight must be attested before test release mutation');
  }

  const releaseLock = acquireTestReleaseLock(context.progressFile, { allowStaleRecovery: retry });
  try {
    const started = beginTestRelease(context.progressFile, {
      source: context.source,
      retry,
      expectedRevision: context.progress.revision,
    });
    if (started.reused && ['succeeded', 'verified'].includes(started.attempt.status)) {
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
      let progress = readProgressV2(context.progressFile);
      for (const repository of context.repositories) {
        const existing = progress.delivery.test.attempts
          .find((attempt) => attempt.id === attemptId)?.integrations?.[repository.id];
        if (existing?.sourceCommit === repository.sourceCommit) continue;
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

      const current = readProgressV2(context.progressFile);
      const attempt = current.delivery.test.attempts.find((item) => item.id === attemptId);
      const driverResult = invokeDriver(context, attempt);
      completeTestRelease(context.progressFile, {
        attemptId,
        status: driverResult.status,
        pipeline: driverResult.pipeline || null,
        deployment: driverResult.deployment || null,
        environmentRevision: driverResult.environment_revision || null,
        reason: driverResult.reason || '',
      });
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
        completeTestRelease(context.progressFile, { attemptId, status: 'failed', reason: error.message });
      }
      throw error;
    }
  } finally {
    releaseLock();
  }
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

function invokeDriver(context, attempt) {
  const payload = {
    schema_version: 1,
    operation: 'release_test',
    feature: context.progress.feature,
    environment: context.release.environment || 'test',
    attempt: attempt.id,
    integrations: attempt.integrations,
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
  if (!TERMINAL_DRIVER_STATUSES.has(result?.status)) {
    throw new Error(`[cc-nexs] invalid test release driver status: ${result?.status || '<missing>'}`);
  }
  if (result.status === 'succeeded' && (!result.pipeline || !result.deployment || !result.environment_revision)) {
    throw new Error('[cc-nexs] successful release driver output requires pipeline, deployment, and environment_revision evidence');
  }
  return result;
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

function validateReleaseUrls(release) {
  const allowed = new Set(release.allowed_hosts || []);
  for (const [name, value] of [['app_url', release.app_url], ['operations_url', release.operations_url]]) {
    if (!value) throw new Error(`[cc-nexs] release.test.${name} is required`);
    let url;
    try { url = new URL(value); } catch { throw new Error(`[cc-nexs] invalid release.test.${name}: ${value}`); }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error(`[cc-nexs] release.test.${name} must use https`);
    }
    if (!allowed.has(url.hostname)) throw new Error(`[cc-nexs] ${url.hostname} is missing from release.test.allowed_hosts`);
    if (/(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) throw new Error(`[cc-nexs] production-like host is forbidden for automatic test release: ${url.hostname}`);
  }
}

function rejectPlaintextCredentials(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (/^(password|passwd|credential|credentials|secret_value)$/i.test(key) && child) {
      throw new Error(`[cc-nexs] plaintext credential field is forbidden: ${next}`);
    }
    rejectPlaintextCredentials(child, next);
  }
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
    repositories: context.repositories.map(({ id, sourceCommit, targetBranch }) => ({ id, sourceCommit, targetBranch })),
    environment: context.release.environment || 'test',
  };
}
