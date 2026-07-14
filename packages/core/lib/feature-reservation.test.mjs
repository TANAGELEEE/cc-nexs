import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { nextFeatureId, releaseFeatureReservation, reserveFeatureId } from './feature-reservation.mjs';

test('feature ids remain reserved before docs merge and cannot be reused', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-id-'));
  const docs = join(root, 'docs');
  mkdirSync(join(docs, 'doc', '154.existing'), { recursive: true });
  const workspace = {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: docs }],
  };
  try {
    assert.equal(nextFeatureId(workspace), '155');
    reserveFeatureId(workspace, { featureId: '155', featureSlug: 'pending-docs' });
    assert.equal(nextFeatureId(workspace), '156');
    assert.throws(() => reserveFeatureId(workspace, { featureId: '155', featureSlug: 'duplicate' }), /reserved/);
    releaseFeatureReservation(workspace, '155');
    assert.equal(nextFeatureId(workspace), '155');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
