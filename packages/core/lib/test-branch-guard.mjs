import { resolve } from 'node:path';

import { loadWorkspaceConfig } from './config-loader.mjs';
import { readProgressV2 } from './progress-v2.mjs';
import { discoverProgressFiles, findWorkspaceRoot } from './worktree-reclaim.mjs';

const INTEGRATION = /\bgit\b[^;&|]*?\s(?:merge|rebase|pull)(?=\s|$)/;

// Returns the test branch a merge, rebase or pull would bring into the current
// checkout, or null. Option values such as commit messages are not refs.
export function testBranchMergeSource(command, testBranches) {
  for (const segment of String(command || '').split(/&&|\|\||[;&|\n]/)) {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((token) => token.replace(/^["']|["']$/g, ''));
    let index = tokens.indexOf('git');
    if (index < 0) continue;
    index += 1;
    while (index < tokens.length && tokens[index].startsWith('-')) index += ['-C', '-c'].includes(tokens[index]) ? 2 : 1;
    if (!['merge', 'rebase', 'pull'].includes(tokens[index])) continue;
    for (let at = index + 1; at < tokens.length; at += 1) {
      if (['-m', '--message', '-F', '--file', '-X', '--strategy-option', '-s', '--strategy'].includes(tokens[at])) { at += 1; continue; }
      const ref = tokens[at].replace(/^(?:refs\/remotes\/origin\/|refs\/heads\/|origin\/)/, '');
      if (testBranches.has(ref)) return ref;
    }
  }
  return null;
}

// Configured test branches plus every active feature's switched test target.
export function workspaceTestBranches(cwd) {
  let root;
  try { root = findWorkspaceRoot(cwd); } catch { return new Set(); }
  const workspace = loadWorkspaceConfig({ projectRoot: root });
  const branches = new Set((workspace?.repositories || []).map((repo) => repo.test_branch).filter(Boolean));
  for (const file of discoverProgressFiles(root, workspace)) {
    try {
      for (const branch of Object.values(readProgressV2(file).delivery?.test?.target?.branches || {})) branches.add(branch);
    } catch {}
  }
  return branches;
}

export function blockedTestBranchIntegration(command, cwd) {
  if (!INTEGRATION.test(String(command || ''))) return null;
  const gitDir = String(command).match(/\bgit\s+-C\s+(\S+)/)?.[1]?.replace(/^["']|["']$/g, '');
  return testBranchMergeSource(command, workspaceTestBranches(gitDir ? resolve(cwd, gitDir) : cwd));
}
