import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { gitIdentityEnv, resolveGitIdentity } from './git-identity.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('repository identity overrides tool-provided author and committer variables', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cc-nexs-identity-'));
  try {
    git(repo, ['init']);
    git(repo, ['config', 'user.name', 'Local Developer']);
    git(repo, ['config', 'user.email', 'local-developer@example.com']);
    const identity = resolveGitIdentity(repo);
    const env = gitIdentityEnv(identity, {
      GIT_AUTHOR_NAME: 'Tool Agent',
      GIT_AUTHOR_EMAIL: 'tool-agent@example.com',
      GIT_COMMITTER_NAME: 'Tool Agent',
      GIT_COMMITTER_EMAIL: 'tool-agent@example.com',
    });
    assert.deepEqual(identity, { name: 'Local Developer', email: 'local-developer@example.com' });
    assert.equal(env.GIT_AUTHOR_NAME, 'Local Developer');
    assert.equal(env.GIT_AUTHOR_EMAIL, 'local-developer@example.com');
    assert.equal(env.GIT_COMMITTER_NAME, 'Local Developer');
    assert.equal(env.GIT_COMMITTER_EMAIL, 'local-developer@example.com');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
