import { readProgress } from './progress-io.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { test, before } from 'node:test';

const tmpDir = '/tmp/cc-nexs-g2-test';

before(() => {
  mkdirSync(tmpDir, { recursive: true });
});

function writeAndRead(content) {
  const p = join(tmpDir, 'progress.md');
  writeFileSync(p, content, 'utf-8');
  return readProgress(p);
}

test('G2 per-sprint: g2_sprint_1_approved parsed from gate section', () => {
  const result = writeAndRead([
    '## 当前状态',
    '',
    '```yaml',
    'current_state: SPRINT_1_DEPLOY_GATE',
    'updated_at: 2026-06-18T10:00:00Z',
    '```',
    '',
    '## 人工 gate',
    '',
    '### G1: Spec 审批',
    '',
    '```yaml',
    'human_approved_at: 2026-06-18T09:00:00Z',
    'human_approver: lee',
    '```',
    '',
    '### G2: 部署测试环境确认',
    '',
    '```yaml',
    'g2_sprint_1_approved: true',
    'g2_approved_at: 2026-06-18T10:00:00Z',
    'g2_approver: lee',
    '```',
    '',
    '## 历史轨迹',
    '',
    '- (尚无)',
    '',
  ].join('\n'));

  console.log('gate:', JSON.stringify(result.gate));
  console.log('workflow:', JSON.stringify(result.workflow));
  assert.strictEqual(result.workflow.g2_approved_sprints[1], true, 'sprint 1 should be approved');
});

test('G2 per-sprint: M1 approved does NOT approve M2', () => {
  const result = writeAndRead([
    '## 当前状态',
    '',
    '```yaml',
    'current_state: SPRINT_2_DEPLOY_GATE',
    '```',
    '',
    '## 人工 gate',
    '',
    '### G1: Spec 审批',
    '',
    '```yaml',
    'human_approved_at: 2026-06-18T09:00:00Z',
    'human_approver: lee',
    '```',
    '',
    '### G2: 部署测试环境确认',
    '',
    '```yaml',
    'g2_sprint_1_approved: true',
    'g2_approved_at: 2026-06-18T10:00:00Z',
    'g2_approver: lee',
    '```',
    '',
    '## 历史轨迹',
    '',
    '- (尚无)',
    '',
  ].join('\n'));

  assert.strictEqual(result.workflow.g2_approved_sprints[1], true, 'sprint 1 should be approved');
  assert.strictEqual(result.workflow.g2_approved_sprints[2], undefined, 'sprint 2 should NOT be approved');
});
