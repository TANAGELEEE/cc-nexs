import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { assertPlanApprovalCurrent } from './plan-contract.mjs';
import {
  candidateFingerprint,
  isLocalVerificationReadyStatus,
  readProgressV2,
  recordLocalVerification,
} from './progress-v2.mjs';

export function runLocalVerification({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  recordStatus = null,
  evidence: recordedEvidence = [],
} = {}) {
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
  const fingerprint = candidateFingerprint(context.source);
  const verificationContext = resolveVerificationContext(context.progress);
  if (recordStatus !== null) {
    if (context.progress.mode !== 'lean') {
      throw new Error('[cc-nexs] direct local evidence recording is available only in Lean mode');
    }
    if (driver) {
      throw new Error('[cc-nexs] workflow.local_verify.driver is configured; run verify-local without direct evidence flags');
    }
    validateRecordedLocalEvidence(recordStatus, recordedEvidence);
    recordLocalVerification(context.progressFile, {
      source: context.source,
      status: recordStatus,
      context: verificationContext,
      evidence: recordedEvidence,
      expectedRevision: context.progress.revision,
      actor: 'local-evidence-controller',
    });
    return {
      kind: 'local-verification',
      feature: context.progress.feature,
      status: recordStatus,
      context: verificationContext,
      evidence: recordedEvidence,
      source: context.source,
      progress: readProgressV2(context.progressFile),
      progressFile: context.progressFile,
    };
  }
  if (
    context.config.mergedWorkflow?.local_verify?.reuse_passed !== false
    && isLocalVerificationReadyStatus(context.progress.local_verification?.status)
    && context.progress.local_verification?.candidate_fingerprint === fingerprint
    && context.progress.local_verification?.context === verificationContext
  ) {
    const previous = context.progress.local_verification.attempts?.findLast((item) => (
      item.fingerprint === fingerprint && isLocalVerificationReadyStatus(item.status)
    ));
    return {
      kind: 'local-verification',
      feature: context.progress.feature,
      status: previous?.status || context.progress.local_verification.status,
      context: context.progress.local_verification?.context || verificationContext,
      evidence: previous?.evidence || [],
      source: context.source,
      reused: true,
      progress: context.progress,
      progressFile: context.progressFile,
    };
  }
  if (!driver) {
    throw new Error('[cc-nexs] workflow.local_verify.driver is not configured; run plan-approved local commands, then use verify-local --passed, --failed, or --deferred-to-test with structured --evidence-json records');
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
    policy: {
      allow_test_defer: context.progress.mode === 'lean',
      defer_contract: {
        status: 'deferred_to_test',
        evidence: { check: '<check>', result: 'deferred_to_test', reason: '<environment limitation>', test_action: '<test action>' },
      },
    },
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

function validateRecordedLocalEvidence(status, evidence) {
  if (!['passed', 'failed', 'deferred_to_test'].includes(status)) {
    throw new Error(`[cc-nexs] invalid recorded local verification status: ${status || '<missing>'}`);
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('[cc-nexs] recorded local verification requires structured evidence');
  }
  const passed = evidence.filter((item) => item?.result === 'passed');
  if (passed.some((item) => (
    typeof item.check !== 'string'
    || !item.check.trim()
    || typeof item.command !== 'string'
    || !item.command.trim()
    || item.exit_code !== 0
    || typeof item.proof !== 'string'
    || !item.proof.trim()
  ))) {
    throw new Error('[cc-nexs] passing local evidence requires check, command, exit_code=0, and proof');
  }
  const failed = evidence.filter((item) => item?.result === 'failed');
  if (failed.some((item) => (
    typeof item.check !== 'string'
    || !item.check.trim()
    || typeof item.command !== 'string'
    || !item.command.trim()
    || !Number.isInteger(item.exit_code)
    || item.exit_code === 0
    || typeof item.proof !== 'string'
    || !item.proof.trim()
  ))) {
    throw new Error('[cc-nexs] failing local evidence requires check, command, a nonzero integer exit_code, and proof');
  }
  if (status === 'failed') {
    if (failed.length === 0 || evidence.some((item) => !['passed', 'failed'].includes(item?.result))) {
      throw new Error('[cc-nexs] a failed local verification requires at least one failed command and may contain only passed or failed evidence');
    }
    return;
  }
  if (passed.length === 0) {
    throw new Error('[cc-nexs] direct local evidence requires at least one passed command with check, command, exit_code=0, and proof');
  }
  if (status === 'passed' && evidence.some((item) => item?.result !== 'passed')) {
    throw new Error('[cc-nexs] a passing local verification may contain only passed evidence');
  }
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
  if (!['passed', 'failed', 'deferred_to_test'].includes(result?.status)) {
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
