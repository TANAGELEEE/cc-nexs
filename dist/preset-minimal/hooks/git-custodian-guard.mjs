#!/usr/bin/env node

import { readFileSync } from 'node:fs';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }
const command = parsed.command || parsed.tool_input?.command || '';
if (!command || !/\bgit\b/.test(command)) process.exit(0);

const mutations = /\bgit(?:\s+-C\s+\S+)?\s+(?:add|commit|push|merge|rebase|checkout|switch|branch|reset|clean|cherry-pick|revert|tag|update-ref|worktree\s+(?:add|remove|move|prune|repair|lock|unlock))\b/;
if (!mutations.test(command)) process.exit(0);
if (process.env.CC_NEXS_ROLE === 'git-custodian') process.exit(0);

console.error('BLOCKED: Git history/worktree mutation is restricted to the Orchestrator-owned Git Custodian.');
process.exit(2);
