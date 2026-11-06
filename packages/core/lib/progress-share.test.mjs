import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { remoteProgressSnapshots, shareProgress } from './progress-share.mjs';
import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { recurringCauses, workspaceStats } from './task-stats.mjs';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-share-'));
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\ndocs_repository: docs\nrepositories:\n  - id: docs\n    path: all-docs\n    docs: true\n');
  writeFileSync(join(root, 'cc-nexs.config.json'), '{}\n');
  git(root, ['init', '-q', '--bare', 'docs.git']);
  git(root, ['clone', '-q', join(root, 'docs.git'), 'all-docs']);
  git(join(root, 'all-docs'), ['config', 'user.name', 'Share Test']);
  git(join(root, 'all-docs'), ['config', 'user.email', 'share@example.com']);
  return root;
}

function task(dir, id, state) {
  mkdirSync(dir, { recursive: true });
  const progress = createProgressV2({ featureId: id, featureSlug: `task-${id}`, preset: 'preset-standard', mode: 'lean', repositories: [] });
  progress.state = state;
  writeProgressV2(join(dir, 'progress.json'), progress);
  return join(dir, 'progress.json');
}

test('share-progress publishes one snapshot per task to its own branch, and stats --remote reads other machines\' tasks', () => {
  const root = workspace();
  const elsewhere = mkdtempSync(join(tmpdir(), 'cc-nexs-share-remote-'));
  try {
    const local = task(join(root, '.worktrees', '379-i18n', 'all-docs', 'doc', '379.i18n'), '379', 'TEST_RELEASE');
    const first = shareProgress({ cwd: root, featureId: '379', progressPath: local });
    assert.equal(first.branch, 'cc-nexs/progress');
    assert.equal(shareProgress({ cwd: root, featureId: '379', progressPath: local }).unchanged, true);
    const remote = task(join(elsewhere, '380.inspiration'), '380', 'TEST_RELEASE_BLOCKED');
    shareProgress({ cwd: root, featureId: '380', progressPath: remote });
    assert.deepEqual(remoteProgressSnapshots(root).map((item) => [item.feature.id, item.state]).sort(), [['379', 'TEST_RELEASE'], ['380', 'TEST_RELEASE_BLOCKED']]);
    assert.equal(git(join(root, 'all-docs'), ['branch', '--list']), '', 'no local branch or worktree was touched');
    const withoutRemote = workspaceStats({ cwd: root });
    assert.deepEqual(withoutRemote.tasks.map((item) => item.feature.id), ['379'], 'an active task in its docs worktree counts');
    const all = workspaceStats({ cwd: root, remote: true });
    assert.deepEqual(all.tasks.map((item) => [item.feature.id, item.source]).sort(), [['379', 'local'], ['380', 'remote']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('recurring causes name the files tasks keep conflicting on and how often verification needed a person', () => {
  const conflict = (repository, conflicts) => ({ type: 'delivery.test.repository_integrated', data: { repository, status: 'conflicts', conflicts } });
  const progresses = ['355', '367', '379'].map((id) => ({
    feature: { id },
    events: [
      conflict('web', ['data/i18n/publication-manifest.json']),
      conflict('web', ['data/i18n/publication-manifest.json', `src/only-${id}.ts`]),
      { type: 'delivery.test.verification_manual_required', data: {} },
      { type: 'delivery.test.verification_passed', data: {} },
      { type: 'state.transition', from: 'TEST_VERIFYING', to: 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY' },
    ],
  }));
  const causes = recurringCauses(progresses);
  assert.deepEqual(causes.recurring_conflicts, [{ path: 'web:data/i18n/publication-manifest.json', conflicts: 6, tasks: 3 }]);
  assert.deepEqual(causes.verification, { passed: 3, product_failed: 0, needs_input: 3 });
  assert.deepEqual(causes.human_stops, { TEST_DEPLOYED_NEEDS_MANUAL_VERIFY: 3 });
  assert.match(causes.suggestions[0], /publication-manifest\.json conflicted 6 times across 3 tasks/);
  assert.match(causes.suggestions[1], /3 of 6 test verifications needed human input/);
});
