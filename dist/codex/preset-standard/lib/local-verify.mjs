import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { assertLocalCandidateWorktree, resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixCandidatePaths, assertHotfixScopeCurrent, extractHotfixScope, resolveHotfixDocument } from './hotfix-contract.mjs';
import { extractLocalVerificationChecks, validateLocalEvidence } from './local-evidence.mjs';
import { assertPlanApprovalCurrent, extractApprovalScope } from './plan-contract.mjs';
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
  else {
    assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
    assertHotfixCandidatePaths(context);
  }
  const allowedStates = context.progress.mode === 'hotfix'
    ? ['HOTFIX_IMPLEMENTING', 'HOTFIX_IMPLEMENTED', 'HOTFIX_FIXING', 'HOTFIX_LOCAL_VERIFYING', 'HOTFIX_LOCAL_REVERIFYING']
    : ['IMPLEMENTING', 'REVIEW_FIXING', 'TEST_FIXING', 'GATEWAY_B_FIXING', 'LOCAL_VERIFYING', 'LOCAL_REVERIFYING', 'GATEWAY_B_LOCAL_REVERIFYING'];
  if (!allowedStates.includes(context.progress.state)) {
    throw new Error(`[cc-nexs] local verification is not valid from ${context.progress.state}`);
  }
  const driver = normalizeDriver(context.config.mergedWorkflow?.local_verify?.driver, context.workspaceRoot);
  const scopeText = readFileSync(context.progress.mode === 'lean'
    ? join(dirname(context.progressFile), 'plan.md')
    : resolveHotfixDocument(context.progress, dirname(context.progressFile)), 'utf8');
  const expectedChecks = extractLocalVerificationChecks(context.progress.mode === 'lean'
    ? extractApprovalScope(scopeText) : extractHotfixScope(scopeText).raw);
  const evidencePolicy = { allowTestDefer: context.progress.mode === 'lean', expectedChecks };
  const contractFingerprint = createHash('sha256').update(JSON.stringify({ driver, ...evidencePolicy })).digest('hex');
  assertVerificationWorktrees(context);
  const fingerprint = candidateFingerprint(context.source);
  const verificationContext = resolveVerificationContext(context.progress);
  if (recordStatus !== null) {
    if (driver) {
      throw new Error('[cc-nexs] workflow.local_verify.driver is configured; run verify-local without direct evidence flags');
    }
    validateLocalEvidence(recordStatus, recordedEvidence, evidencePolicy);
    recordLocalVerification(context.progressFile, {
      source: context.source,
      status: recordStatus,
      context: verificationContext,
      evidence: recordedEvidence,
      contractFingerprint,
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
      && item.context === verificationContext && item.contract_fingerprint === contractFingerprint
    ));
    // Older success records must meet the current contract before they can be reused.
    let reusable = false;
    try {
      validateLocalEvidence(previous?.status, previous?.evidence?.filter((item) => item?.type !== 'p3_boundary' || Object.hasOwn(item, 'result')), evidencePolicy);
      reusable = true;
    } catch { /* Rerun the driver or request fresh direct evidence below. */ }
    if (reusable) return {
      kind: 'local-verification',
      feature: context.progress.feature,
      status: previous.status,
      context: context.progress.local_verification?.context || verificationContext,
      evidence: previous.evidence,
      source: context.source,
      reused: true,
      progress: context.progress,
      progressFile: context.progressFile,
    };
  }

  if (!driver) {
    const flags = context.progress.mode === 'lean' ? '--passed, --failed, or --deferred-to-test' : '--passed or --failed';
    throw new Error(`[cc-nexs] workflow.local_verify.driver is not configured; run scope-bound local commands in the exact candidate worktrees, then use verify-local ${flags} with structured --evidence-json records`);
  }
  const payload = {
    schema_version: 1,
    operation: 'verify_local',
    feature: context.progress.feature,
    source: context.source,
    reused: false,
    repositories: Object.fromEntries(context.repositories.map((item) => [item.id, {
      worktree: item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : null,
      branch: item.assignment.branch,
      commit: item.sourceCommit,
    }])),
    policy: {
      allow_test_defer: evidencePolicy.allowTestDefer,
      expected_checks: expectedChecks,
      defer_contract: {
        status: 'deferred_to_test',
        evidence: { check: '<check>', result: 'deferred_to_test', reason: '<environment limitation>', test_action: '<test action>' },
      },
    },
  };
  const result = invokeLocalVerifyDriver({ driver, workspaceRoot: context.workspaceRoot, payload });
  assertVerificationWorktrees(context);
  const evidence = result.evidence || [];
  recordLocalVerification(context.progressFile, {
    source: context.source,
    status: result.status,
    context: verificationContext,
    evidence,
    contractFingerprint,
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

function assertVerificationWorktrees(context) {
  for (const item of context.repositories) {
    assertLocalCandidateWorktree({
      repository: item.id,
      worktree: item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : null,
      branch: item.assignment.branch,
      sourceCommit: item.sourceCommit,
    });
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
  validateLocalEvidence(result.status, result.evidence, {
    allowTestDefer: payload.policy?.allow_test_defer === true,
    expectedChecks: payload.policy?.expected_checks || [],
  });
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
