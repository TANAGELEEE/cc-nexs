import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { approvedPlanRiskTier, assertPlanApprovalCurrent, inspectPlanRiskBinding, planApprovalBinding } from './plan-contract.mjs';

function plan(riskTier) {
  return `# Plan\n\n<!-- APPROVAL-SCOPE START -->\n\n## Risk\n\n- risk_tier: ${riskTier}\n\n<!-- APPROVAL-SCOPE END -->\n`;
}

test('Gateway A binding stores a concrete risk tier inside the approved scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('high'));
    const binding = planApprovalBinding(root, { requireRiskTier: true });
    assert.equal(binding.risk_tier, 'high');
    const progress = { mode: 'lean', gates: { plan: { approved: true, binding } } };
    assert.equal(approvedPlanRiskTier(progress, root), 'high');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gateway A rejects unresolved automatic risk', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('auto'));
    assert.throws(() => planApprovalBinding(root, { requireRiskTier: true }), /requires plan\.md risk_tier/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy Gateway A risk is derivable only while the approved hashes remain current', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('critical'));
    const binding = planApprovalBinding(root);
    delete binding.risk_tier;
    const progress = { mode: 'lean', gates: { plan: { approved: true, binding } } };
    assert.deepEqual(inspectPlanRiskBinding(progress, root), { status: 'derivable', risk_tier: 'critical' });
    assert.equal(approvedPlanRiskTier(progress, root), 'critical');

    writeFileSync(join(root, 'plan.md'), plan('low'));
    assert.throws(() => inspectPlanRiskBinding(progress, root), /changed after Gateway A/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stored Gateway A risk must match its hashed plan scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('high'));
    const binding = { ...planApprovalBinding(root), risk_tier: 'low' };
    const progress = { mode: 'lean', gates: { plan: { approved: true, binding } } };
    assert.throws(() => assertPlanApprovalCurrent(progress, root), /does not match hashed plan scope/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
