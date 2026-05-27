#!/usr/bin/env node
// cc-nexs cross-platform PreToolUse hook: approval gate enforcement.
// When any progress.md in cwd has current_state == SPEC_PENDING_HUMAN (or whatever the preset's
// configured human_gate_state is), block all "advancement" commands until /cc-nexs:approve-spec runs.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FORBIDDEN_PATTERNS = [
  /\bcodex\b/,
  /\bmvn\b/,
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bpnpm\s+(test|run\s+build)\b/,
  /\bnpm\s+(test|run\s+build)\b/,
  /\bcargo\s+(test|build|run)\b/,
  /\bgo\s+(test|build|run)\b/,
];

let input = '';
try { input = readFileSync(0, 'utf-8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }

const cmd = parsed.command || parsed.tool_input?.command || '';
const filePath = parsed.file_path || parsed.tool_input?.file_path || '';
if (!cmd && !filePath) process.exit(0);

function findProgressFiles(root, depth = 0, max = 4) {
  if (depth > max) return [];
  const out = [];
  let entries;
  try { entries = readdirSync(root); } catch { return []; }
  for (const e of entries) {
    if (e.startsWith('.') || e === 'node_modules') continue;
    const full = join(root, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      out.push(...findProgressFiles(full, depth + 1, max));
    } else if (e === 'progress.md') {
      out.push(full);
    }
  }
  return out;
}

const cwd = process.cwd();
const docDir = existsSync(join(cwd, 'doc')) ? join(cwd, 'doc') : cwd;
const progressFiles = findProgressFiles(docDir);

const HUMAN_GATE_STATES = (process.env.CC_NEXS_HUMAN_GATE_STATES || 'SPEC_PENDING_HUMAN').split(',');

for (const pf of progressFiles) {
  let text;
  try { text = readFileSync(pf, 'utf-8'); } catch { continue; }
  const m = text.match(/current_state:\s*(\S+)/);
  if (!m) continue;
  const state = m[1];
  if (!HUMAN_GATE_STATES.includes(state)) continue;

  // Check write paths to src/ are also blocked
  if (filePath && /(^|\/)src\/(main|test)\//.test(filePath)) {
    console.error(`[cc-nexs approval-gate] State ${state}: cannot edit ${filePath} until /cc-nexs:approve-spec runs`);
    process.exit(2);
  }

  if (cmd && FORBIDDEN_PATTERNS.some((p) => p.test(cmd))) {
    console.error(`[cc-nexs approval-gate] State ${state}: command blocked until /cc-nexs:approve-spec runs`);
    console.error(`[cc-nexs approval-gate] Blocked: ${cmd}`);
    process.exit(2);
  }
}

process.exit(0);
