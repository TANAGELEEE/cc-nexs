#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const args = process.argv.slice(2);
const strictRelease = args.includes('--release-test');
const root = resolve(args.find((arg) => !arg.startsWith('-')) || process.cwd());
const errors = [];
const warnings = [];
let workspace = null;
let config = null;
try { workspace = loadWorkspaceConfig({ projectRoot: root }); } catch (error) { errors.push(error.message); }
try {
  const pluginRoot = [
    process.env.CC_NEXS_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.PLUGIN_ROOT,
  ].find((candidate) => candidate && existsSync(join(candidate, 'preset.yml')));
  config = loadConfig({ projectRoot: root, ...(pluginRoot && { presetRoot: pluginRoot }) });
} catch (error) { errors.push(error.message); }

if (!workspace) warnings.push('workspace config not found; single-repository mode only');
else {
  for (const repo of workspace.repositories) {
    if (!existsSync(repo.absolute_path)) {
      errors.push(`repository path missing: ${repo.id}`);
      continue;
    }
    try { execFileSync('git', ['-C', repo.absolute_path, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); }
    catch { errors.push(`not a git repository: ${repo.id}`); }
  }
}

if (config) validateReleaseReadiness({ config, workspace, strictRelease, errors, warnings });

function findProgressFiles(dir, depth = 0) {
  if (!existsSync(dir) || depth > 5) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findProgressFiles(target, depth + 1));
    else if (entry.isFile() && entry.name === 'progress.json') files.push(target);
  }
  return files;
}

const docsSource = workspace?.repositories.find((repo) => repo.id === workspace.docs_repository)?.absolute_path || join(root, 'all-docs');
const progressFiles = new Set([
  ...findProgressFiles(join(docsSource, 'doc')),
  ...(workspace ? findProgressFiles(workspace.worktree_root) : []),
]);
for (const file of progressFiles) {
    const featureDir = dirname(file);
    const featureName = basename(featureDir);
    const activeWorktreeState = workspace && resolve(file).startsWith(`${resolve(workspace.worktree_root)}${process.platform === 'win32' ? '\\' : '/'}`);
    try {
      const progress = readProgressV2(file);
      const featureConfig = join(featureDir, 'config.json');
      if (existsSync(featureConfig)) {
        const configuredMode = JSON.parse(readFileSync(featureConfig, 'utf8')).mode || 'lean';
        if (configuredMode !== progress.mode) errors.push(`${featureName}: config mode ${configuredMode} != progress mode ${progress.mode}`);
      }
      for (const [repoId, assignment] of Object.entries(progress.repositories || {})) {
        const repo = workspace?.repositories.find((item) => item.id === repoId);
        if (!repo) { errors.push(`${featureName}: unknown assigned repository ${repoId}`); continue; }
        // Merged docs intentionally retain their historical assignments after
        // finalize removes runtime worktrees. Only active state under
        // worktree_root must still resolve to a live worktree and branch.
        if (!activeWorktreeState) continue;
        if (assignment.base_branch && assignment.base_branch !== repo.base_branch) {
          errors.push(`${featureName}: configured base ${repo.base_branch} != assigned base ${assignment.base_branch} for ${repoId}`);
        }
        const assignedWorktree = assignment.worktree ? resolve(root, assignment.worktree) : null;
        if (!assignedWorktree || !existsSync(assignedWorktree)) {
          errors.push(`${featureName}: assigned worktree missing for ${repoId}`);
          continue;
        }
        const branch = execFileSync('git', ['-C', assignedWorktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
        if (branch !== assignment.branch) errors.push(`${featureName}: branch mismatch for ${repoId}`);
      }
    } catch (error) { errors.push(`${featureName}: ${error.message}`); }
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
else console.log(`cc-nexs doctor passed (${workspace?.repositories.length || 1} repository configuration).`);

function validateReleaseReadiness({ config, workspace, strictRelease, errors, warnings }) {
  const policy = config.mergedWorkflow?.test_release?.policy;
  if (policy !== 'auto_if_ready' && !strictRelease) return;
  const report = (message) => (strictRelease ? errors : warnings).push(message);
  if (['lean', 'hotfix'].includes(config.mergedWorkflow?.default_mode) && !config.mergedWorkflow?.local_verify?.driver?.command) {
    report(`${config.mergedWorkflow.default_mode} mode requires workflow.local_verify.driver.command for build/start/smoke verification`);
  }
  if (!workspace) {
    report('automatic test release requires .cc-nexs/workspace.yml or workspace.json');
    return;
  }
  const codeRepositories = workspace.repositories.filter((repo) => repo.id !== workspace.docs_repository && repo.docs !== true);
  if (codeRepositories.length === 0) report('automatic test release requires at least one code repository');
  for (const repo of codeRepositories) {
    if (!repo.test_branch) report(`repository ${repo.id} is missing test_branch`);
  }

  const release = config.mergedRelease?.test || {};
  if ((release.environment || 'test').toLowerCase() !== 'test') report('automatic release environment must be test');
  if (!release.driver?.command) report('release.test.driver.command is required for automatic test release');
  if (release.browser?.required !== false) {
    for (const field of ['claude_provider', 'codex_provider', 'pi_provider']) {
      if (!release.browser?.[field]) report(`release.test.browser.${field} is required`);
    }
  }
  const allowed = new Set(release.allowed_hosts || []);
  for (const [name, value] of [['app_url', release.app_url], ['operations_url', release.operations_url]]) {
    if (!value) { report(`release.test.${name} is required`); continue; }
    let url;
    try { url = new URL(value); }
    catch { report(`release.test.${name} is invalid: ${value}`); continue; }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      report(`release.test.${name} must use https`);
    }
    if (!allowed.has(url.hostname)) report(`${url.hostname} is missing from release.test.allowed_hosts`);
    if (/(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) report(`production-like host is forbidden: ${url.hostname}`);
  }
  for (const finding of findPlaintextCredentialFields({ project: config.project, overlay: config.overlay })) {
    errors.push(`plaintext credential field is forbidden: ${finding}`);
  }

  if (process.env.CC_NEXS_RUNTIME === 'pi') {
    try {
      const installed = execFileSync('pi', ['list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (!installed.includes('injaneity/pi-computer-use') && !installed.includes('@injaneity/pi-computer-use')) {
        report('Pi automatic browser verification requires @injaneity/pi-computer-use@0.4.3');
      }
    } catch {
      report('unable to inspect installed Pi computer-use package');
    }
  }
}

function findPlaintextCredentialFields(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (/^(password|passwd|credential|credentials|secret_value)$/i.test(key) && child) findings.push(next);
    else findings.push(...findPlaintextCredentialFields(child, next));
  }
  return findings;
}
