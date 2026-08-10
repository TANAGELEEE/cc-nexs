import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPlanRiskTier, normalizeRiskTier } from './model-routing.mjs';

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

export function planApprovalBinding(reqDir, { requireRiskTier = false } = {}) {
  const requirements = normalized(readFileSync(join(reqDir, 'requirements.md'), 'utf8'));
  const plan = readFileSync(join(reqDir, 'plan.md'), 'utf8');
  const approvalScope = extractApprovalScope(plan);
  const riskTier = extractPlanRiskTier(approvalScope);
  if (requireRiskTier && (!riskTier || riskTier === 'auto')) {
    throw new Error('[cc-nexs] Gateway A requires plan.md risk_tier to be low, medium, high, or critical');
  }
  return {
    requirements_sha256: digest(requirements),
    plan_scope_sha256: digest(approvalScope),
    combined_sha256: digest(`${requirements}\n${approvalScope}`),
    risk_tier: riskTier,
  };
}

export function approvedPlanRiskTier(progress, reqDir) {
  const inspected = inspectPlanRiskBinding(progress, reqDir);
  if (inspected.status === 'not_approved') {
    throw new Error('[cc-nexs] current Lean plan has not passed Gateway A');
  }
  return inspected.risk_tier;
}

export function inspectPlanRiskBinding(progress, reqDir) {
  if (progress?.mode !== 'lean') return { status: 'not_applicable', risk_tier: null };
  if (progress.gates?.plan?.approved !== true) return { status: 'not_approved', risk_tier: null };
  const current = assertPlanApprovalCurrent(progress, reqDir);
  const stored = normalizeStoredRisk(progress.gates.plan.binding.risk_tier);
  if (stored) return { status: 'bound', risk_tier: stored };
  if (current.risk_tier && current.risk_tier !== 'auto') {
    return { status: 'derivable', risk_tier: current.risk_tier };
  }
  return { status: 'unstructured', risk_tier: null };
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
  const storedRisk = normalizeStoredRisk(approved.binding.risk_tier);
  if (approved.binding.risk_tier !== undefined
    && approved.binding.risk_tier !== null
    && approved.binding.risk_tier !== ''
    && !storedRisk) {
    throw new Error('[cc-nexs] approved Gateway A binding has a non-concrete risk_tier');
  }
  if (storedRisk && storedRisk !== current.risk_tier) {
    throw new Error(`[cc-nexs] approved Gateway A risk_tier ${storedRisk} does not match hashed plan scope ${current.risk_tier || '(missing)'}`);
  }
  return current;
}

function normalizeStoredRisk(value) {
  if (value === undefined || value === null || value === '') return null;
  const riskTier = normalizeRiskTier(value);
  return riskTier === 'auto' ? null : riskTier;
}

export const PLAN_SCOPE_MARKERS = { START, END };
