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

export function extractPlanDeliveryLane(planText) {
  const declared = [...String(planText).matchAll(/^\s*-\s*delivery_lane:\s*(\S+)\s*$/gmi)];
  if (declared.length === 1 && !['fast-track', 'standard'].includes(declared[0][1].toLowerCase())) {
    throw new Error('[cc-nexs] plan.md delivery_lane must be fast-track or standard');
  }
  const matches = declared.filter((match) => ['fast-track', 'standard'].includes(match[1].toLowerCase()));
  if (declared.length > 1) {
    throw new Error('[cc-nexs] plan.md approval scope must contain exactly one delivery_lane');
  }
  return matches[0]?.[1]?.toLowerCase() || null;
}

export function extractPlanTestDelivery(planText) {
  const delivery = {};
  for (const match of String(planText).matchAll(/^\s*-\s*test_delivery\.([a-z][a-z0-9-]*):\s*(deploy|local)\s*$/gmi)) {
    const repository = match[1].toLowerCase();
    if (delivery[repository]) {
      throw new Error(`[cc-nexs] plan.md approval scope contains duplicate test_delivery.${repository}`);
    }
    delivery[repository] = match[2].toLowerCase();
  }
  return delivery;
}

// before-final-test: derived paths (generated bindings, manifests) stay at
// their base values through implementation and Test rounds and are generated
// once for the final Test attempt. each-candidate (the default) regenerates
// them with every candidate.
export function extractPlanDerivedBinding(planText) {
  const declared = [...String(planText).matchAll(/^\s*-\s*derived_binding:\s*(\S+)\s*$/gmi)];
  if (declared.length > 1) throw new Error('[cc-nexs] plan.md approval scope must contain at most one derived_binding');
  if (!declared.length) return null;
  const value = declared[0][1].toLowerCase();
  if (!['before-final-test', 'each-candidate'].includes(value)) {
    throw new Error('[cc-nexs] plan.md derived_binding must be before-final-test or each-candidate');
  }
  return value === 'before-final-test' ? value : null;
}

function tableRows(text, prefix) {
  return text.split('\n').filter((line) => new RegExp(`^\\|\\s*${prefix}-\\d+\\s*\\|`).test(line));
}

function acIds(lines) {
  return new Set(lines.flatMap((line) => line.match(/\bAC-\d+\b/g) || []));
}

// Paths that make a plan ineligible for --auto-plan, require a Review of a low/medium
// candidate, and send an amendment to independent review, whatever risk the Planner
// declared: data migrations, infrastructure and CI files, and directories named for
// auth, permission, secrets, payment or deployment. Directory names match whole path
// segments, so a module such as `sa-deployment/` or a page such as `BillingPage.tsx` is
// not sensitive by name; a workspace lists its own business-critical code in
// `review.required_paths`.
const SENSITIVE_SEGMENT = new Set([
  'migration', 'migrations', 'auth', 'permission', 'permissions', 'security', 'secret', 'secrets',
  'credential', 'credentials', 'iam', 'payment', 'payments', 'billing', 'terraform', 'helm', 'k8s',
  'kubernetes', 'deploy', 'deployment', 'deployments',
]);
const SENSITIVE_FILE = /(^|\/)(Dockerfile(\.[^/]*)?|docker-compose[^/]*\.ya?ml|\.gitlab-ci\.yml|schema\.prisma)$|\.(sql|tf)$|(^|\/)\.github\/workflows\//i;

export function isSensitivePlanPath(path) {
  const normalized = String(path).replace(/\\/g, '/');
  if (SENSITIVE_FILE.test(normalized)) return true;
  const segments = normalized.split('/');
  // The last segment is a directory too unless it names a file (`src/auth` vs `src/auth.ts`).
  if (segments.at(-1).includes('.')) segments.pop();
  return segments.some((segment) => SENSITIVE_SEGMENT.has(segment.toLowerCase()));
}

export function sensitivePlanPaths(planText) {
  const rows = tableRows(extractApprovalScope(planText), 'T');
  const paths = rows.flatMap((line) => (line.split('|')[4] || '').split(/[\s,，、;；]+/))
    .map((token) => token.replace(/^`+|`+$/g, '').trim())
    .filter(Boolean);
  return [...new Set(paths.filter(isSensitivePlanPath))];
}

export function requirementAcIds(reqDir) {
  const requirements = readFileSync(join(reqDir, 'requirements.md'), 'utf8').replace(/\r\n/g, '\n');
  return [...new Set(tableRows(requirements, 'AC').map((line) => line.match(/AC-\d+/)[0]))];
}

// Every acceptance criterion in requirements.md must be planned, checked locally, and
// verified in test; a plan may not invent criteria the requirements do not contain.
export function assertRequirementTraceability(reqDir) {
  const scope = extractApprovalScope(readFileSync(join(reqDir, 'plan.md'), 'utf8'));
  const required = requirementAcIds(reqDir);
  if (required.length === 0) throw new Error('[cc-nexs] requirements.md must list acceptance criteria as AC-xxx table rows');
  const coverage = { task: acIds(tableRows(scope, 'T')), 'local check': acIds(tableRows(scope, 'LV')), 'test check': acIds(tableRows(scope, 'TV')) };
  const gaps = [];
  for (const [kind, covered] of Object.entries(coverage)) {
    const missing = required.filter((id) => !covered.has(id));
    if (missing.length) gaps.push(`${kind}: ${missing.join(', ')}`);
  }
  const unknown = [...new Set(Object.values(coverage).flatMap((covered) => [...covered]))].filter((id) => !required.includes(id));
  if (unknown.length) gaps.push(`not in requirements.md: ${unknown.join(', ')}`);
  if (gaps.length) throw new Error(`[cc-nexs] plan.md does not trace every requirement (${gaps.join('; ')})`);
  return required;
}

// What an independent plan review judged: the requirements, the task table (tasks,
// paths, ACs), and the classification lines. A later edit that leaves these unchanged
// (verification matrices, delivery notes, design prose) keeps a passed plan review.
const CLASSIFICATION_LINE = /^\s*-\s*(risk_tier|delivery_lane|test_delivery\.[\w.-]+|derived_binding)\s*:/;

function planReviewScopeDigest(requirements, approvalScope) {
  const lines = approvalScope.split('\n');
  const tasks = tableRows(approvalScope, 'T').map((line) => line.trim());
  const classification = lines.filter((line) => CLASSIFICATION_LINE.test(line)).map((line) => line.trim());
  return digest(`${requirements}\n${tasks.join('\n')}\n${classification.join('\n')}`);
}

export function planApprovalBinding(reqDir, { requireRiskTier = false, requireDeliveryLane = false } = {}) {
  const requirements = normalized(readFileSync(join(reqDir, 'requirements.md'), 'utf8'));
  const plan = readFileSync(join(reqDir, 'plan.md'), 'utf8');
  const approvalScope = extractApprovalScope(plan);
  const riskTier = extractPlanRiskTier(approvalScope);
  const deliveryLane = extractPlanDeliveryLane(approvalScope);
  const testDelivery = extractPlanTestDelivery(approvalScope);
  const derivedBinding = extractPlanDerivedBinding(approvalScope);
  if (requireRiskTier && (!riskTier || riskTier === 'auto')) {
    throw new Error('[cc-nexs] Gateway A requires plan.md risk_tier to be low, medium, high, or critical');
  }
  if (requireDeliveryLane && !deliveryLane) {
    throw new Error('[cc-nexs] Gateway A requires plan.md delivery_lane to be fast-track or standard');
  }
  if (deliveryLane === 'fast-track' && !['low', 'medium'].includes(riskTier)) {
    throw new Error('[cc-nexs] fast-track delivery requires low or medium risk_tier');
  }
  return {
    requirements_sha256: digest(requirements),
    plan_scope_sha256: digest(approvalScope),
    combined_sha256: digest(`${requirements}\n${approvalScope}`),
    review_scope_sha256: planReviewScopeDigest(requirements, approvalScope),
    risk_tier: riskTier,
    delivery_lane: deliveryLane || (requireRiskTier ? 'standard' : null),
    delivery_contract_version: deliveryLane ? 1 : 0,
    test_delivery: testDelivery,
    ...(derivedBinding && { derived_binding: derivedBinding }),
  };
}

export function approvedPlanDeliveryLane(progress, reqDir) {
  if (progress?.mode !== 'lean' || progress.gates?.plan?.approved !== true) {
    throw new Error('[cc-nexs] current Lean plan has not passed Gateway A');
  }
  const current = assertPlanApprovalCurrent(progress, reqDir);
  const stored = normalizeStoredDeliveryLane(progress.gates.plan.binding.delivery_lane);
  return stored || normalizeStoredDeliveryLane(current.delivery_lane) || 'standard';
}

export function approvedPlanTestDelivery(progress, reqDir) {
  if (progress?.mode !== 'lean' || progress.gates?.plan?.approved !== true) {
    throw new Error('[cc-nexs] current Lean plan has not passed Gateway A');
  }
  return assertPlanApprovalCurrent(progress, reqDir).test_delivery;
}

export function approvedPlanDeliveryContract(progress, reqDir) {
  const testDelivery = approvedPlanTestDelivery(progress, reqDir);
  const storedVersion = Number(progress.gates.plan.binding.delivery_contract_version || 0);
  return {
    version: Number.isInteger(storedVersion) && storedVersion >= 0 ? storedVersion : 0,
    lane: approvedPlanDeliveryLane(progress, reqDir),
    repositories: testDelivery,
    targets: progress.gates.plan.binding.test_targets || {},
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
  const storedLane = normalizeStoredDeliveryLane(approved.binding.delivery_lane);
  if (approved.binding.delivery_lane !== undefined
    && approved.binding.delivery_lane !== null
    && approved.binding.delivery_lane !== ''
    && !storedLane) {
    throw new Error('[cc-nexs] approved Gateway A binding has an invalid delivery_lane');
  }
  // A lane added to an already-approved legacy binding defaults safely to
  // standard even when the older hashed plan did not contain the field.
  if (storedLane && current.delivery_lane && storedLane !== current.delivery_lane) {
    throw new Error(`[cc-nexs] approved Gateway A delivery_lane ${storedLane} does not match hashed plan scope ${current.delivery_lane || '(missing)'}`);
  }
  return current;
}

function normalizeStoredRisk(value) {
  if (value === undefined || value === null || value === '') return null;
  const riskTier = normalizeRiskTier(value);
  return riskTier === 'auto' ? null : riskTier;
}

function normalizeStoredDeliveryLane(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['fast-track', 'standard'].includes(value) ? value : null;
}

export const PLAN_SCOPE_MARKERS = { START, END };
