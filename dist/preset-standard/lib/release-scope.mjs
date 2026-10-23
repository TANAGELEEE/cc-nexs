import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertPlanApprovalCurrent, extractApprovalScope } from './plan-contract.mjs';
import { assertHotfixScopeCurrent, extractHotfixScope, resolveHotfixDocument } from './hotfix-contract.mjs';

export function releaseScope(progress, progressFile) {
  const directory = dirname(progressFile);
  if (progress.mode === 'lean') {
    assertPlanApprovalCurrent(progress, directory);
    return extractApprovalScope(readFileSync(join(directory, 'plan.md'), 'utf8'));
  }
  if (progress.mode === 'hotfix') {
    assertHotfixScopeCurrent(progress, directory);
    return extractHotfixScope(readFileSync(resolveHotfixDocument(progress, directory), 'utf8')).raw;
  }
  throw new Error(`[cc-nexs] unsupported mode: ${progress.mode}`);
}
