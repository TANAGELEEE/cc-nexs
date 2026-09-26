#!/usr/bin/env node
// cc-nexs cross-platform PreToolUse hook: role boundary enforcement.
// Reads CC_NEXS_ROLE env, looks up role allowed_files in active preset, blocks violations.
//
// Hook protocol (Claude Code): receives JSON via stdin, exits 0 to allow / 2 to block.
// Tool input schema:
//   { command?: string, file_path?: string, ... }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { roleBoundaryViolation } from '../lib/role-boundary.mjs';

const role = process.env.CC_NEXS_ROLE;
if (!role) process.exit(0); // Not in a role-tagged session

let input = '';
try { input = readFileSync(0, 'utf-8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }

const cmd = parsed.command || parsed.tool_input?.command || '';
const filePath = parsed.file_path || parsed.tool_input?.file_path || '';

const violation = roleBoundaryViolation({
  role,
  toolName: parsed.tool_name || '',
  filePath,
  command: cmd,
  cwd: parsed.cwd || process.cwd(),
  progressPath: process.env.CC_NEXS_PROGRESS_FILE
    || (process.env.CC_NEXS_REQ_DIR ? resolve(process.env.CC_NEXS_REQ_DIR, 'progress.json') : null),
});
if (violation) {
  console.error(`[cc-nexs role-boundary] ${violation}`);
  process.exit(2);
}

process.exit(0);
