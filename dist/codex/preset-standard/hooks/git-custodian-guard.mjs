#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { isGitMutation } from '../lib/role-boundary.mjs';
import { blockedTestBranchIntegration } from '../lib/test-branch-guard.mjs';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }
const command = parsed.command || parsed.tool_input?.command || '';
if (!command) process.exit(0);

// Test branches carry other unreleased features, so no session, parent
// included, may merge, rebase or pull one into a checkout in a cc-nexs workspace.
const testBranch = blockedTestBranchIntegration(command, parsed.cwd || process.cwd());
if (testBranch) {
  console.error(`BLOCKED: merging, rebasing or pulling test branch ${testBranch} brings other unreleased features into this branch. cc-nexs integrates candidates into test only in temporary worktrees; use /cc-nexs:release-test, and resolve test conflicts with /cc-nexs:resolve-test-conflict.`);
  process.exit(2);
}
if (!isGitMutation(command)) process.exit(0);
const role = process.env.CC_NEXS_ROLE || '';

// The parent session represents the user's authority boundary. Restrict only
// role-tagged child sessions; otherwise the plugin would globally take Git
// control away from the user even while a workflow is paused.
if (!role || role === 'git-custodian') process.exit(0);

console.error(`BLOCKED: role ${role} cannot mutate Git; use the parent-owned Git Custodian workflow.`);
process.exit(2);
