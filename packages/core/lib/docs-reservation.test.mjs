import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { publishDocsReservation } from './docs-reservation.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function configure(repo, name = 'Example User', email = 'example@example.com') {
  git(repo, ['config', 'user.name', name]);
  git(repo, ['config', 'user.email', email]);
}

function commitIdentity(repo, commit) {
  return git(repo, ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', commit]).split('\0');
}

function workspace(root, docs) {
  return {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: docs, base_branch: 'master' }],
  };
}

test('docs reservations are visible on remote master and allocate across developers', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-doc-reserve-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const devA = join(root, 'dev-a');
  const devB = join(root, 'dev-b');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, seed]);
  configure(seed);
  git(seed, ['checkout', '-b', 'master']);
  mkdirSync(join(seed, 'doc', '01.existing'), { recursive: true });
  writeFileSync(join(seed, 'doc', '01.existing', 'README.md'), '# Existing\n');
  git(seed, ['add', 'doc']);
  git(seed, ['commit', '-m', 'initial docs']);
  git(seed, ['push', '-u', 'origin', 'master']);
  git(root, ['clone', origin, devA]);
  git(root, ['clone', origin, devB]);
  configure(devA, 'Developer A', 'developer-a@example.com');
  configure(devB, 'Developer B', 'developer-b@example.com');
  try {
    const first = publishDocsReservation(workspace(join(root, 'workspace-a'), devA), { featureSlug: 'first-feature' });
    const second = publishDocsReservation(workspace(join(root, 'workspace-b'), devB), { featureSlug: 'second-feature' });
    assert.equal(first.featureId, '02');
    assert.equal(second.featureId, '03');
    git(seed, ['fetch', 'origin', 'master']);
    assert.deepEqual(commitIdentity(seed, first.commit), [
      'Developer A', 'developer-a@example.com', 'Developer A', 'developer-a@example.com',
    ]);
    assert.deepEqual(commitIdentity(seed, second.commit), [
      'Developer B', 'developer-b@example.com', 'Developer B', 'developer-b@example.com',
    ]);
    assert.match(git(seed, ['show', 'origin/master:doc/02.first-feature/.cc-nexs-reservation.json']), /"status": "RESERVED"/);
    assert.match(git(seed, ['show', 'origin/master:doc/03.second-feature/README.md']), /Feature number reserved/);

    const resumed = publishDocsReservation(workspace(join(root, 'workspace-a'), devA), { featureId: '02', featureSlug: 'first-feature' });
    assert.equal(resumed.alreadyReserved, true);
    const resumedWithoutId = publishDocsReservation(workspace(join(root, 'workspace-a'), devA), { featureSlug: 'first-feature' });
    assert.equal(resumedWithoutId.featureId, '02');
    assert.throws(
      () => publishDocsReservation(workspace(join(root, 'workspace-b'), devB), { featureId: '02', featureSlug: 'duplicate' }),
      /already exists on origin\/master/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
