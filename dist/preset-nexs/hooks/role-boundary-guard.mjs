#!/usr/bin/env node
// cc-nexs cross-platform PreToolUse hook: role boundary enforcement.
// Reads CC_NEXS_ROLE env, looks up role allowed_files in active preset, blocks violations.
//
// Hook protocol (Claude Code): receives JSON via stdin, exits 0 to allow / 2 to block.
// Tool input schema:
//   { command?: string, file_path?: string, ... }

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  || resolve(fileURLToPath(import.meta.url), '../..');

const role = process.env.CC_NEXS_ROLE;
if (!role) process.exit(0); // Not in a role-tagged session

let input = '';
try { input = readFileSync(0, 'utf-8'); } catch { process.exit(0); }
let parsed = {};
try { parsed = JSON.parse(input); } catch { process.exit(0); }

const cmd = parsed.command || parsed.tool_input?.command || '';
const filePath = parsed.file_path || parsed.tool_input?.file_path || '';

// Default rules per common role names. Preset can override via preset.yml roles.definitions.<name>.boundaries
const DEFAULT_RULES = {
  planner: {
    forbid_write_paths: [/(^|\/)src\//, /(^|\/)progress\.md$/],
    forbid_commands: [/\bmvn\b/, /\bcodex\b/, /\bgit\s+commit\b/],
    msg: 'Planner role: cannot write code or run build/review commands',
  },
  pm: { /* alias of planner */ },
  'tech-lead': {
    forbid_write_paths: [/\/(spec|acceptance|sa-review|sa-code-review|sa-test-review|test-report)\.md$/, /(^|\/)progress\.md$/],
    msg: 'Tech Lead role: cannot edit spec / acceptance / review / test-report / progress',
  },
  developer: { /* alias of tech-lead */ },
  dev: { /* alias of tech-lead */ },
  qa: {
    forbid_read_paths: [/(^|\/)src\/(main|test)\//, /\/sa-review\.md$/, /\/sa-code-review\.md$/],
    msg: 'QA role: black-box; cannot read src/ or sa-*.md (sa-test-review.md exception handled at agent level)',
  },
  evaluator: {
    forbid_read_paths: [/(^|\/)src\//, /\/sa-.*\.md$/, /\/dev-plan\.md$/],
    msg: 'Evaluator role: cannot read src/, sa-*, dev-plan.md',
  },
  reviewer: {
    // fast 模式 reviewer 合并 SA 代码评审 + Evaluator 契约打分。
    // 禁读 src/（基于 diff 评审）+ dev-plan.md（避免被实现视角污染）。
    forbid_read_paths: [/(^|\/)src\//, /\/dev-plan\.md$/],
    msg: 'Reviewer role (fast): cannot read src/ or dev-plan.md (review based on diff + spec)',
  },
  verifier: {
    // fast 模式 verifier 合并 QA cases + run + regression，黑盒纪律 = QA + 不读 sa-test-review.md
    forbid_read_paths: [/(^|\/)src\/(main|test)\//, /\/sa-review\.md$/, /\/sa-code-review\.md$/, /\/sa-test-review\.md$/],
    msg: 'Verifier role (fast): black-box; cannot read src/ or sa-*.md',
  },
  fullstack: {
    // fast 模式合并 Planner + Tech Lead，二者规则取交集后只剩"不可改 progress.md"
    forbid_write_paths: [/(^|\/)progress\.md$/, /\/acceptance\.md$/, /\/sa-.*\.md$/, /\/test-report\.md$/],
    msg: 'Fullstack role (fast): cannot edit progress / acceptance / sa-* / test-report (orchestrator/Reviewer/Verifier own those)',
  },
};

const aliasMap = { pm: 'planner', developer: 'tech-lead', dev: 'tech-lead' };
const ruleKey = aliasMap[role] || role;
const rule = DEFAULT_RULES[ruleKey];
if (!rule) process.exit(0); // Unknown role → permissive

function matches(patterns, str) {
  if (!patterns || !str) return false;
  return patterns.some((p) => p.test(str));
}

// Tool input mode: read or write?
const isWrite = parsed.tool_name === 'Edit' || parsed.tool_name === 'Write' || parsed.tool_name === 'NotebookEdit';

if (isWrite && matches(rule.forbid_write_paths, filePath)) {
  console.error(`[cc-nexs role-boundary] ${rule.msg} (path: ${filePath})`);
  process.exit(2);
}

// Read forbidding only kicks in for explicit Read tool
const isRead = parsed.tool_name === 'Read';
if (isRead && matches(rule.forbid_read_paths, filePath)) {
  console.error(`[cc-nexs role-boundary] ${rule.msg} (read denied: ${filePath})`);
  process.exit(2);
}

if (cmd && matches(rule.forbid_commands, cmd)) {
  console.error(`[cc-nexs role-boundary] ${rule.msg} (command: ${cmd})`);
  process.exit(2);
}

process.exit(0);
