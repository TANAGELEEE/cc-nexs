#!/usr/bin/env node
// cc-nexs cross-platform PreToolUse hook: approval gate enforcement.
// G1 (SPEC_PENDING_HUMAN): blocks all advancement commands.
// G2 (DEPLOY_GATE): blocks coding/testing/codex but ALLOWS git merge/push to test
//    (since human needs to merge+deploy during this phase before approving G2).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Commands blocked during G1 (spec gate) — everything advancement-related
const G1_FORBIDDEN = [
  /\bcodex\b/,
  /\bmvn\b/,
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bpnpm\s+(test|run\s+build)\b/,
  /\bnpm\s+(test|run\s+build)\b/,
  /\bcargo\s+(test|build|run)\b/,
  /\bgo\s+(test|build|run)\b/,
];

// Commands blocked during G2 (deploy gate) — only testing/codex, NOT build/merge/push.
// Human needs to merge feature→test, verify build, and push during G2.
const G2_FORBIDDEN = [
  /\bcodex\b/,
  /\bmvn\s+test\b/,
  /\bpnpm\s+test\b/,
  /\bnpm\s+test\b/,
  /\bcargo\s+(test|run)\b/,
  /\bgo\s+(test|run)\b/,
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

const HUMAN_GATE_STATES = (process.env.CC_NEXS_HUMAN_GATE_STATES || 'SPEC_PENDING_HUMAN,DEPLOY_GATE').split(',');

// Also match sprint-prefixed deploy gates: SPRINT_1_DEPLOY_GATE, SPRINT_2_DEPLOY_GATE, etc.
const DEPLOY_GATE_RE = /^(SPRINT_\d+_)?DEPLOY_GATE$/;

for (const pf of progressFiles) {
  let text;
  try { text = readFileSync(pf, 'utf-8'); } catch { continue; }
  const m = text.match(/current_state:\s*(\S+)/);
  if (!m) continue;
  const state = m[1];
  if (!HUMAN_GATE_STATES.includes(state) && !DEPLOY_GATE_RE.test(state)) continue;

  const isG2 = DEPLOY_GATE_RE.test(state);
  const approveCmd = isG2 ? '/cc-nexs:approve-deploy' : '/cc-nexs:approve-spec';
  const forbidden = isG2 ? G2_FORBIDDEN : G1_FORBIDDEN;

  // Check write paths to src/ are also blocked
  if (filePath && /(^|\/)src\/(main|test)\//.test(filePath)) {
    console.error(`[cc-nexs approval-gate] State ${state}: cannot edit ${filePath} until ${approveCmd} runs`);
    process.exit(2);
  }

  if (cmd && forbidden.some((p) => p.test(cmd))) {
    console.error(`[cc-nexs approval-gate] State ${state}: command blocked until ${approveCmd} runs`);
    console.error(`[cc-nexs approval-gate] Blocked: ${cmd}`);
    process.exit(2);
  }
}

process.exit(0);
