import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendProgressEvent, createProgressV2, readProgressV2, recordRepositoryAssignments, writeProgressV2 } from './progress-v2.mjs';

test('progress v2 appends idempotent events and rejects stale writers', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard' }));
    appendProgressEvent(file, { type: 'state.transition', from: 'INIT', to: 'REQ_DRAFTED', expectedRevision: 0, eventId: 'event-1' });
    appendProgressEvent(file, { type: 'state.transition', from: 'INIT', to: 'REQ_DRAFTED', eventId: 'event-1' });
    const progress = readProgressV2(file);
    assert.equal(progress.state, 'REQ_DRAFTED');
    assert.equal(progress.revision, 1);
    assert.equal(progress.events.length, 1);
    assert.throws(() => appendProgressEvent(file, { type: 'state.transition', from: 'REQ_DRAFTED', to: 'SPEC_DRAFTED', expectedRevision: 0 }), /stale progress revision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository assignments persist only workspace-relative paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-path-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '02', featureSlug: 'paths', preset: 'preset-standard' }));
    recordRepositoryAssignments(file, [{ repository: 'api', branch: 'feature/02-paths', worktree: join(root, '.worktrees/02-paths/api'), baseBranch: 'master', baseCommit: 'abc123' }], { workspaceRoot: root });
    const progress = readProgressV2(file);
    assert.equal(progress.repositories.api.worktree, '.worktrees/02-paths/api');
    assert.equal(progress.repositories.api.base_branch, 'master');
    assert.equal(progress.repositories.api.base_commit, 'abc123');
    assert.equal(JSON.stringify(progress).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
