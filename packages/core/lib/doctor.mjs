#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const root = resolve(process.argv[2] || process.cwd());
const errors = [];
const warnings = [];
let workspace = null;
try { workspace = loadWorkspaceConfig({ projectRoot: root }); } catch (error) { errors.push(error.message); }
try { loadConfig({ projectRoot: root }); } catch (error) { errors.push(error.message); }

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
        const configuredMode = JSON.parse(readFileSync(featureConfig, 'utf8')).mode || 'fast';
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
