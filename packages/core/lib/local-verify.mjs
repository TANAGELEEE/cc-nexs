import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { assertPlanApprovalCurrent } from './plan-contract.mjs';
import { candidateFingerprint, readProgressV2, recordLocalVerification } from './progress-v2.mjs';

export function runLocalVerification({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  if (!['lean', 'hotfix'].includes(context.progress.mode)) throw new Error(`[cc-nexs] local verification control requires lean or hotfix mode, found ${context.progress.mode}`);
  if (context.progress.mode === 'lean') assertPlanApprovalCurrent(context.progress, dirname(context.progressFile));
  else assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
  const allowedStates = context.progress.mode === 'hotfix'
    ? ['HOTFIX_IMPLEMENTING', 'HOTFIX_IMPLEMENTED', 'HOTFIX_FIXING', 'HOTFIX_LOCAL_VERIFYING', 'HOTFIX_LOCAL_REVERIFYING']
    : ['IMPLEMENTING', 'REVIEW_FIXING', 'TEST_FIXING', 'GATEWAY_B_FIXING', 'LOCAL_VERIFYING', 'LOCAL_REVERIFYING', 'GATEWAY_B_LOCAL_REVERIFYING'];
  if (!allowedStates.includes(context.progress.state)) {
    throw new Error(`[cc-nexs] local verification is not valid from ${context.progress.state}`);
  }
  const driver = normalizeDriver(context.config.mergedWorkflow?.local_verify?.driver, context.workspaceRoot);
  if (!driver) throw new Error('[cc-nexs] workflow.local_verify.driver is required for lean mode');
  const fingerprint = candidateFingerprint(context.source);
  const verificationContext = resolveVerificationContext(context.progress);
  if (
    context.config.mergedWorkflow?.local_verify?.reuse_passed !== false
    && context.progress.local_verification?.status === 'passed'
    && context.progress.local_verification?.candidate_fingerprint === fingerprint
  ) {
    const previous = context.progress.local_verification.attempts?.findLast((item) => item.fingerprint === fingerprint && item.status === 'passed');
    return {
      kind: 'local-verification',
      feature: context.progress.feature,
      status: 'passed',
      context: context.progress.local_verification?.context || verificationContext,
      evidence: previous?.evidence || [],
      source: context.source,
      reused: true,
      progress: context.progress,
      progressFile: context.progressFile,
    };
  }
  const payload = {
    schema_version: 1,
    operation: 'verify_local',
    feature: context.progress.feature,
    source: context.source,
    reused: false,
    repositories: Object.fromEntries(context.repositories.map((item) => [item.id, {
      worktree: resolve(context.workspaceRoot, item.assignment.worktree),
      branch: item.assignment.branch,
      commit: item.sourceCommit,
    }])),
  };
  const result = invokeLocalVerifyDriver({ driver, workspaceRoot: context.workspaceRoot, payload });
  const evidence = result.evidence || [];
  recordLocalVerification(context.progressFile, {
    source: context.source,
    status: result.status,
    context: verificationContext,
    evidence,
    expectedRevision: context.progress.revision,
  });
  return {
    kind: 'local-verification',
    feature: context.progress.feature,
    status: result.status,
    context: verificationContext,
    evidence,
    source: context.source,
    progress: readProgressV2(context.progressFile),
    progressFile: context.progressFile,
  };
}

function resolveVerificationContext(progress) {
  const existing = progress.local_verification?.context || null;
  if (progress.mode === 'hotfix') {
    if (['HOTFIX_FIXING', 'HOTFIX_LOCAL_REVERIFYING'].includes(progress.state)) return 'hotfix_fix';
    return existing || 'implementation';
  }
  if (['TEST_FIXING'].includes(progress.state)) return 'test';
  if (['GATEWAY_B_FIXING', 'GATEWAY_B_LOCAL_REVERIFYING'].includes(progress.state)) return 'gateway_b';
  if (['REVIEW_FIXING', 'LOCAL_REVERIFYING'].includes(progress.state)) return existing || 'review';
  return existing || 'implementation';
}

export function invokeLocalVerifyDriver({ driver, workspaceRoot, payload }) {
  let output;
  try {
    output = execFileSync(driver.command, driver.args, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      input: `${JSON.stringify(payload)}\n`,
      timeout: driver.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CC_NEXS_FEATURE_ID: String(payload.feature.id) },
    }).trim();
  } catch (error) {
    throw new Error(`[cc-nexs] local verification driver failed: ${error.stderr?.toString().trim() || error.message}`);
  }
  let result;
  try { result = JSON.parse(output); }
  catch { throw new Error('[cc-nexs] local verification driver must write one JSON object to stdout'); }
  if (!['passed', 'failed'].includes(result?.status)) {
    throw new Error(`[cc-nexs] invalid local verification status: ${result?.status || '<missing>'}`);
  }
  if (!Array.isArray(result.evidence)) throw new Error('[cc-nexs] local verification evidence must be an array');
  return result;
}

function normalizeDriver(driver, workspaceRoot) {
  if (!driver || typeof driver !== 'object' || !driver.command) return null;
  const command = isAbsolute(driver.command)
    ? driver.command
    : driver.command.startsWith('.') || driver.command.includes('/')
      ? resolve(workspaceRoot, driver.command)
      : driver.command;
  if (isAbsolute(command) && !existsSync(command)) throw new Error(`[cc-nexs] local verification driver not found: ${command}`);
  const timeoutSeconds = Number(driver.timeout_seconds || 1200);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) throw new Error('[cc-nexs] local verification timeout_seconds must be positive');
  return { command, args: Array.isArray(driver.args) ? driver.args.map(String) : [], timeoutMs: timeoutSeconds * 1000 };
}
