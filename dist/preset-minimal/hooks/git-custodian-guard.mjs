#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { isGitMutation } from '../lib/role-boundary.mjs';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }
const command = parsed.command || parsed.tool_input?.command || '';
if (!command || !isGitMutation(command)) process.exit(0);
if (process.env.CC_NEXS_ROLE === 'git-custodian') process.exit(0);

console.error('BLOCKED: Git history/worktree mutation is restricted to the Orchestrator-owned Git Custodian.');
process.exit(2);
