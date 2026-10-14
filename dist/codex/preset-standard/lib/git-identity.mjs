import { execFileSync } from 'node:child_process';

function readConfig(repo, key) {
  try {
    return execFileSync('git', ['-C', repo, 'config', '--get', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export function resolveGitIdentity(repo) {
  const name = readConfig(repo, 'user.name');
  const email = readConfig(repo, 'user.email');
  if (!name || !email) {
    throw new Error('[cc-nexs] repository must configure git user.name and user.email before creating a commit');
  }
  if (/[\r\n\0]/.test(name) || /[\r\n\0]/.test(email)) {
    throw new Error('[cc-nexs] repository git identity contains invalid characters');
  }
  return { name, email };
}

export function gitIdentityEnv(identity, baseEnv = process.env) {
  return {
    ...baseEnv,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}
