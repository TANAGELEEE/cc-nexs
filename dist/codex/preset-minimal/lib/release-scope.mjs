import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertPlanApprovalCurrent, extractApprovalScope } from './plan-contract.mjs';
import { assertHotfixScopeCurrent, extractHotfixScope, resolveHotfixDocument } from './hotfix-contract.mjs';
import { assertImplementationApprovalCurrent } from './implementation-plan.mjs';
import { resolveAssignedCodeRepositories } from './approval-command.mjs';

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
  if (!progress.gates?.g1?.approved) throw new Error('[cc-nexs] release requires approved G1 scope');
  const text = readFileSync(join(directory, 'spec.md'), 'utf8');
  assertImplementationApprovalCurrent(progress, text, {
    repositories: resolveAssignedCodeRepositories({ progressFile, progress }), mode: progress.mode,
  });
  return text;
}
