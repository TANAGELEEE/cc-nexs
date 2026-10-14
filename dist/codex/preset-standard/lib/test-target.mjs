import { approvedPlanDeliveryContract } from './plan-contract.mjs';
import { dirname } from 'node:path';
import { resolveCandidateContext } from './candidate-context.mjs';
import { acquireTestReleaseLock } from './test-release.mjs';
import { appendMutationEvent, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

export function switchTestTarget({ cwd, featureId, progressPath, target, authorizationEvidence }) {
  if (typeof authorizationEvidence !== 'string' || !authorizationEvidence.trim()) throw new Error('test target switch requires user authorization evidence');
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  const release = acquireTestReleaseLock(context.progressFile);
  try {
    const progress = readProgressV2(context.progressFile);
    if (['running', 'deploying', 'awaiting_receipt'].includes(progress.delivery.test.status)) {
      throw new Error('finish or explicitly cancel the active deployment before switching targets');
    }
    if (!['ACCEPTANCE', 'FINAL_EVAL', 'TEST_RELEASE', 'TEST_RELEASE_BLOCKED', 'TEST_VERIFYING', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', 'RELEASE_PENDING_HUMAN', 'TEST', 'REGRESSION', 'FINAL_QA', 'HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_RELEASE_BLOCKED', 'HOTFIX_TEST_VERIFYING', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', 'HOTFIX_RELEASE_PENDING_HUMAN'].includes(progress.state)) throw new Error('test target switch requires an active test or release gate');
    const delivery = progress.mode === 'lean' ? approvedPlanDeliveryContract(progress, dirname(context.progressFile)) : null;
    const ids = Object.keys(context.source).filter(id => delivery?.repositories[id] !== 'local');
    validateTestTarget(target, context.workspace.repositories, ids);
    const previous = progress.delivery.test.target || null;
    if (JSON.stringify(previous) === JSON.stringify(target)) return { kind: 'test-target', changed: false, progressFile: context.progressFile };
    const latest = progress.delivery.test.attempts.at(-1);
    if (latest) latest.invalidated_at = new Date().toISOString();
    progress.delivery.test.target = structuredClone(target);
    progress.delivery.test.status = 'idle';
    progress.gates.release = { ...progress.gates.release, approved: false };
    progress.state = progress.mode === 'hotfix' ? 'HOTFIX_TEST_RELEASE' : 'TEST_RELEASE';
    appendMutationEvent(progress, { type: 'delivery.test.target_changed', actor: 'user', data: { previous, target, authorizationEvidence } });
    writeProgressV2(context.progressFile, progress);
    return { kind: 'test-target', changed: true, progressFile: context.progressFile, target };
  } finally { release(); }
}

export function validateTestTarget(target, repositories, ids) {
  const fields = ['kind', 'environment', 'branches', 'allowed_hosts', 'app_url', 'operations_url'];
  if (target && Object.keys(target).some(key => !fields.includes(key))) throw new Error('unsupported test target field');
  if (!target || target.kind !== 'test' || !/^[a-zA-Z0-9][\w.-]*$/.test(target.environment || '')
    || /(^|[_.-])(prod|production|live)([_.-]|$)/i.test(target.environment)) throw new Error('target must declare a non-production test environment');
  if (JSON.stringify(Object.keys(target.branches || {}).sort()) !== JSON.stringify([...ids].sort())) throw new Error('test target must bind all candidate repositories');
  for (const id of ids) {
    const branch = target.branches[id];
    const repo = repositories.find((item) => item.id === id);
    if (!repo || !/^[a-zA-Z0-9][\w.-]*$/.test(branch || '') || branch === repo.base_branch
      || /^(main|master|prod|production|live)$/i.test(branch)) throw new Error(`unsafe test branch for ${id}`);
  }
  if (!Array.isArray(target.allowed_hosts) || !target.allowed_hosts.length || target.allowed_hosts.some(host => typeof host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(host))) throw new Error('test target requires allowed_hosts');
  for (const field of ['app_url', 'operations_url']) {
    const url = new URL(target[field]);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || !target.allowed_hosts.includes(url.hostname)
      || /(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) throw new Error(`unsafe test target ${field}`);
  }
}
