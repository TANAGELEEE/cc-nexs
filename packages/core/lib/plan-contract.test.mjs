import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  approvedPlanDeliveryLane,
  approvedPlanTestDelivery,
  approvedPlanRiskTier,
  assertPlanApprovalCurrent,
  inspectPlanRiskBinding,
  isSensitivePlanPath,
  planApprovalBinding,
} from './plan-contract.mjs';

function plan(riskTier, deliveryLane = 'standard') {
  return `# Plan\n\n<!-- APPROVAL-SCOPE START -->\n\n## Risk\n\n- risk_tier: ${riskTier}\n- delivery_lane: ${deliveryLane}\n- test_delivery.backend-java: deploy\n- test_delivery.web: local\n\n<!-- APPROVAL-SCOPE END -->\n`;
}

test('Gateway A binding stores a concrete risk tier inside the approved scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('high'));
    const binding = planApprovalBinding(root, { requireRiskTier: true, requireDeliveryLane: true });
    assert.equal(binding.risk_tier, 'high');
    assert.equal(binding.delivery_lane, 'standard');
    const progress = { mode: 'lean', gates: { plan: { approved: true, binding } } };
    assert.equal(approvedPlanRiskTier(progress, root), 'high');
    assert.equal(approvedPlanDeliveryLane(progress, root), 'standard');
    assert.deepEqual(approvedPlanTestDelivery(progress, root), { 'backend-java': 'deploy', web: 'local' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gateway A defaults a legacy plan without delivery lane to standard', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('low').replace('- delivery_lane: standard\n', ''));
    const binding = planApprovalBinding(root, { requireRiskTier: true });
    assert.equal(binding.delivery_lane, 'standard');
    assert.equal(approvedPlanDeliveryLane({ mode: 'lean', gates: { plan: { approved: true, binding } } }, root), 'standard');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gateway A rejects high-risk fast-track plans', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('high', 'fast-track'));
    assert.throws(() => planApprovalBinding(root, { requireRiskTier: true }), /fast-track delivery requires low or medium/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gateway A binds the fast-track delivery lane and rejects an unresolved lane', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-plan-contract-'));
  try {
    writeFileSync(join(root, 'requirements.md'), '# Requirements\n');
    writeFileSync(join(root, 'plan.md'), plan('medium', 'fast-track'));
    const binding = planApprovalBinding(root, { requireRiskTier: true, requireDeliveryLane: true });
    assert.equal(binding.delivery_lane, 'fast-track');

    writeFileSync(join(root, 'plan.md'), plan('medium', 'pending'));
    assert.throws(
      () => planApprovalBinding(root, { requireRiskTier: true, requireDeliveryLane: true }),
      /delivery_lane must be fast-track or standard/,
    );
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

test('sensitive paths match infrastructure files and whole directory names only', () => {
  for (const path of [
    'db/migrations/001.sql', 'api/db/migration/V12__add_export.sql', 'src/auth/session.ts', 'src/billing/plan.ts',
    'api/auth', 'deploy/values.yaml', 'helm/app/values.yaml', 'infra/main.tf', 'Dockerfile', 'web/Dockerfile.test',
    'docker-compose.test.yml', '.gitlab-ci.yml', '.github/workflows/ci.yml', 'prisma/schema.prisma', 'src\\Auth\\Filter.java',
  ]) assert.equal(isSensitivePlanPath(path), true, path);
  for (const path of [
    'sa-deployment/sa-dp-claw/src/main/java/com/example/claw/ClawController.java', 'src/pages/BillingPage.tsx',
    'src/lib/author.ts', 'src/hooks/useCreditSummary.ts', 'src/lib/seo/schema.ts', 'src/billing.ts', 'src/app/page.tsx',
  ]) assert.equal(isSensitivePlanPath(path), false, path);
});
