#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { isGitMutation } from '../lib/role-boundary.mjs';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }
const command = parsed.command || parsed.tool_input?.command || '';
if (!command || !isGitMutation(command)) process.exit(0);
const role = process.env.CC_NEXS_ROLE || '';

// The parent session represents the user's authority boundary. Restrict only
// role-tagged child sessions; otherwise the plugin would globally take Git
// control away from the user even while a workflow is paused.
if (!role || role === 'git-custodian') process.exit(0);

console.error(`BLOCKED: role ${role} cannot mutate Git; use the parent-owned Git Custodian workflow.`);
process.exit(2);
