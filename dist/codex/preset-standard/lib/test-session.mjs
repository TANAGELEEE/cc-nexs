// Test-environment browser sessions for Verifiers.
//
// Browser provider: each runtime drives the deployed app with its own agent browser.
// Claude Code and Pi prefer ego lite when its probe succeeds (Claude falls back to
// chrome-devtools-mcp, Pi to its headless computer-use Verifier); Codex uses its
// current in-app/Chrome session.
//
// Account: a Verifier first reuses a session the provider browser is already signed in
// with. Otherwise it signs in with `release.test.credential_ref`, an opaque reference
// this module resolves without printing it:
//
//   env:<USER_VAR>,<PASSWORD_VAR>                     variables already in the environment
//   dotenv:<path>#<USER_VAR>,<PASSWORD_VAR>           an untracked env file, relative to the workspace
//   keychain:<service>/<account>                      macOS Keychain generic password
//
// Values are only handed to a child process (`test-account -- <command>`) as
// CC_NEXS_TEST_USER and CC_NEXS_TEST_PASSWORD, so they never enter a prompt or a log.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { findWorkspaceRoot, loadCandidateConfig } from './candidate-context.mjs';
import { inspectEgoLite, inspectPiBrowserCapability } from './pi-browser-provider.mjs';

const VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveBrowserProvider({ runtime, browser = {}, execFile = execFileSync, projectRoot = process.cwd() } = {}) {
  if (runtime === 'codex') return { runtime, provider: browser.codex_provider || 'current-browser-session', fallback: false };
  if (runtime === 'claude') {
    const configured = browser.claude_provider || 'ego-lite';
    if (configured !== 'ego-lite') return { runtime, provider: configured, fallback: false };
    const ego = inspectEgoLite({ execFile });
    return ego.ready
      ? { runtime, provider: 'ego-lite', fallback: false }
      : { runtime, provider: 'chrome-devtools-mcp', fallback: true, reason: ego.reason };
  }
  if (runtime === 'pi') {
    const capability = inspectPiBrowserCapability({ projectRoot, execFile });
    return capability.ready
      ? { runtime, provider: capability.provider, fallback: Boolean(capability.fallback), ...(capability.fallback && { reason: capability.primaryFailure }) }
      : { runtime, provider: null, fallback: false, reason: capability.reason };
  }
  throw new Error(`[cc-nexs] runtime must be claude, codex, or pi, got ${runtime || '(missing)'}`);
}

export function parseCredentialRef(ref) {
  const text = String(ref || '').trim();
  const pair = (value) => {
    const names = value.split(',').map((item) => item.trim());
    if (names.length !== 2 || !names.every((name) => VAR.test(name))) throw new Error('[cc-nexs] credential_ref must name a user variable and a password variable');
    return { userVar: names[0], passwordVar: names[1] };
  };
  if (text.startsWith('env:')) return { scheme: 'env', ...pair(text.slice(4)) };
  if (text.startsWith('dotenv:')) {
    const [path, vars] = text.slice(7).split('#');
    if (!path || !vars) throw new Error('[cc-nexs] credential_ref dotenv must look like dotenv:<path>#<USER_VAR>,<PASSWORD_VAR>');
    return { scheme: 'dotenv', path, ...pair(vars) };
  }
  if (text.startsWith('keychain:')) {
    const [service, account] = text.slice(9).replace(/^\/\//, '').split('/');
    if (!service || !account) throw new Error('[cc-nexs] credential_ref keychain must look like keychain:<service>/<account>');
    return { scheme: 'keychain', service, account };
  }
  throw new Error('[cc-nexs] credential_ref must start with env:, dotenv:, or keychain:');
}

function readDotenv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function isTrackedByGit(file, execFile) {
  try {
    execFile('git', ['-C', dirname(file), 'ls-files', '--error-unmatch', basename(file)], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export function resolveCredential({ ref, workspaceRoot, env = process.env, execFile = execFileSync }) {
  const parsed = parseCredentialRef(ref);
  if (parsed.scheme === 'keychain') {
    let password = '';
    try {
      password = execFile('security', ['find-generic-password', '-s', parsed.service, '-a', parsed.account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { password = ''; }
    return { source: `keychain ${parsed.service}/${parsed.account}`, user: parsed.account, password };
  }
  let values = env;
  let source = 'environment';
  if (parsed.scheme === 'dotenv') {
    const file = isAbsolute(parsed.path) ? parsed.path : resolve(workspaceRoot, parsed.path);
    if (!existsSync(file)) return { source: `dotenv ${parsed.path} (missing)`, user: '', password: '' };
    if (isTrackedByGit(file, execFile)) throw new Error(`[cc-nexs] credential file is tracked by Git; credentials must stay in an untracked file: ${parsed.path}`);
    values = { ...readDotenv(file), ...Object.fromEntries([parsed.userVar, parsed.passwordVar].filter((name) => env[name]).map((name) => [name, env[name]])) };
    source = `dotenv ${parsed.path}`;
  }
  return { source, user: values[parsed.userVar] || '', password: values[parsed.passwordVar] || '' };
}

function workspaceRelease(cwd) {
  const workspaceRoot = findWorkspaceRoot(cwd);
  return { workspaceRoot, release: loadCandidateConfig(workspaceRoot).mergedRelease?.test || {} };
}

export function browserProviderStatus({ cwd = process.cwd(), runtime, execFile = execFileSync } = {}) {
  const { workspaceRoot, release } = workspaceRelease(cwd);
  return { kind: 'browser-provider', ...resolveBrowserProvider({ runtime, browser: release.browser || {}, execFile, projectRoot: workspaceRoot }) };
}

export function testAccount({ cwd = process.cwd(), command = [], env = process.env, execFile = execFileSync, spawn = spawnSync } = {}) {
  const { workspaceRoot, release } = workspaceRelease(cwd);
  if (!release.credential_ref) {
    return { kind: 'test-account', configured: false, ready: false, source: null, message: 'release.test.credential_ref is not configured; reuse a signed-in browser session or ask the human to sign in' };
  }
  const credential = resolveCredential({ ref: release.credential_ref, workspaceRoot, env, execFile });
  const ready = Boolean(credential.user && credential.password);
  if (command.length === 0) {
    return { kind: 'test-account', configured: true, ready, source: credential.source, user: credential.user ? 'present' : 'missing', password: credential.password ? 'present' : 'missing' };
  }
  if (!ready) throw new Error(`[cc-nexs] test account from ${credential.source} is incomplete; nothing was run`);
  const result = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...env, CC_NEXS_TEST_USER: credential.user, CC_NEXS_TEST_PASSWORD: credential.password },
  });
  if (result.error) throw new Error(`[cc-nexs] could not run ${command[0]}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`[cc-nexs] ${command[0]} exited with ${result.status ?? result.signal}`);
  return { kind: 'test-account', configured: true, ready: true, source: credential.source, ran: command[0] };
}
