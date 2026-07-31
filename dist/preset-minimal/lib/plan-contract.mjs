import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const START = '<!-- APPROVAL-SCOPE START -->';
const END = '<!-- APPROVAL-SCOPE END -->';

function normalized(text) {
  return text.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function extractApprovalScope(planText) {
  const start = planText.indexOf(START);
  const end = planText.indexOf(END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`[cc-nexs] plan.md must contain ${START} and ${END}`);
  }
  return normalized(planText.slice(start + START.length, end));
}

export function planApprovalBinding(reqDir) {
  const requirements = normalized(readFileSync(join(reqDir, 'requirements.md'), 'utf8'));
  const plan = readFileSync(join(reqDir, 'plan.md'), 'utf8');
  const approvalScope = extractApprovalScope(plan);
  return {
    requirements_sha256: digest(requirements),
    plan_scope_sha256: digest(approvalScope),
    combined_sha256: digest(`${requirements}\n${approvalScope}`),
  };
}

export function assertPlanApprovalCurrent(progress, reqDir) {
  if (progress?.mode !== 'lean') return null;
  const approved = progress.gates?.plan;
  if (!approved?.approved || !approved.binding?.combined_sha256) {
    throw new Error('[cc-nexs] current Lean plan has not passed Gateway A');
  }
  const current = planApprovalBinding(reqDir);
  if (current.combined_sha256 !== approved.binding.combined_sha256) {
    throw new Error('[cc-nexs] requirements or approved plan scope changed after Gateway A');
  }
  return current;
}

export const PLAN_SCOPE_MARKERS = { START, END };
