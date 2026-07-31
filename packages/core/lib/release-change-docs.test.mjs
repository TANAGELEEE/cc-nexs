import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { syncPlanChangeStatuses } from './release-change-docs.mjs';

test('Gateway B plan rows track addressed and approved request status', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-change-docs-'));
  const plan = join(root, 'plan.md');
  try {
    writeFileSync(plan, [
      '## Gateway B 变更请求',
      '',
      '| ID | 类型 | 提出人 | 影响 AC | 允许修改路径 | 意见 | 状态 |',
      '|---|---|---|---|---|---|---|',
      '| gateway-b-1 | implementation | owner | AC-001 | src/a.ts | first | open |',
      '| gateway-b-2 | implementation | owner | AC-002 | src/b.ts | second | open |',
      '',
    ].join('\n'));
    const changed = syncPlanChangeStatuses(plan, [
      { id: 'gateway-b-1', status: 'addressed' },
      { id: 'gateway-b-2', status: 'approved' },
    ]);
    const text = readFileSync(plan, 'utf8');
    assert.equal(changed, true);
    assert.match(text, /gateway-b-1 .*\| addressed \|/);
    assert.match(text, /gateway-b-2 .*\| approved \|/);
    assert.equal(syncPlanChangeStatuses(plan, [{ id: 'gateway-b-2', status: 'approved' }]), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
