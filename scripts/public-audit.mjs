#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const withHistory = process.argv.includes('--history');

const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:\.claude-runtime|\.in_use|\.cc-nexs|\.worktrees)(?:\/|$)/,
  /\.(?:pem|key|p12|pfx|jks|keystore|dump|sqlite\d*)$/i,
];

const forbiddenReleasePaths = [
  /(^|\/)(?:fixtures|__fixtures__|__tests__)(?:\/|$)/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
];

const contentChecks = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['github-token', /\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['stripe-key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['credential-url', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['mac-home-path', /\/Users\/(?!example-user(?:\/|\b))[^/\s'"`]+(?:\/|\b)/],
  ['linux-home-path', /\/home\/(?!example-user(?:\/|\b))[^/\s'"`]+(?:\/|\b)/],
  ['windows-home-path', /\b[A-Za-z]:\\Users\\(?!example-user(?:\\|\b))[^\\\s'"`]+(?:\\|\b)/i],
  ['private-ip', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/],
  ['personal-email', /\b[A-Z0-9._%+-]+@(?!example\.(?:com|invalid)\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
];

const denylistPath = process.env.CC_NEXS_PUBLIC_DENYLIST_FILE;
const denylist = denylistPath
  ? readFileSync(denylistPath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  : [];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean)
  .sort();

const findings = [];
function report(code, file, line = 1) {
  findings.push(`${code} ${file}:${line}`);
}

for (const file of files) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    report('path-outside-root', file);
    continue;
  }
  if (!existsSync(absolute)) continue;

  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    report('tracked-symlink', file);
    continue;
  }
  if (!stat.isFile()) continue;

  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    report('forbidden-path', file);
  }
  if (file.startsWith('dist/') && forbiddenReleasePaths.some((pattern) => pattern.test(file))) {
    report('release-test-artifact', file);
  }

  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [code, pattern] of contentChecks) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) report(code, file, index + 1);
    }
    if (denylist.some((term) => line.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) {
      report('private-denylist-term', file, index + 1);
    }
  }
}

if (withHistory) {
  const records = git(['log', '--format=%ae%x00%ce%x00']).split('\0').map((value) => value.trim()).filter(Boolean);
  for (const email of new Set(records)) {
    if (!/@(?:users\.noreply\.github\.com|example\.(?:com|invalid))$/i.test(email)) {
      findings.push('history-personal-email git-history:1');
    }
  }
}

if (findings.length) {
  console.error(`Public audit failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public audit passed (${files.length} files${withHistory ? ', including history metadata' : ''}).`);
}
