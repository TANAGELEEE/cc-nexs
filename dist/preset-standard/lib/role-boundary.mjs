import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolveHotfixDocument } from './hotfix-contract.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const CODEX_COMMAND = /(?:^|[;&|]\s*)(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*codex(?:\s|$)/;

const DEFAULT_RULES = {
  'lean-planner': {
    allowWritePaths: [/(^|\/)(?:requirements|plan)\.md$/],
    forbidWritePaths: [/(^|\/)src\//, /(^|\/)progress\.(?:md|json)$/],
    forbidCommands: [CODEX_COMMAND, /\bgit\s+(?:add|commit|push|merge|rebase|checkout|switch|branch)\b/],
    message: 'Lean Planner: may write requirements/plan only, never code, progress, or Git state',
  },
  'lean-plan-reviewer': {
    allowWritePaths: [/(^|\/)plan\.md$/],
    forbidWritePaths: [/(^|\/)src\//, /(^|\/)requirements\.md$/, /(^|\/)progress\.(?:md|json)$/],
    forbidCommands: [CODEX_COMMAND, /\bgit\s+(?:add|commit|push|merge|rebase|checkout|switch|branch)\b/],
    message: 'Lean Plan Reviewer: read requirements, plan, and source; write only the plan review section',
  },
  'lean-developer': {
    forbidWritePaths: [/(^|\/)requirements\.md$/, /(^|\/)progress\.(?:md|json)$/],
    message: 'Lean Developer: cannot edit requirements or progress',
  },
  'lean-reviewer': {
    allowWritePaths: [/(^|\/)plan\.md$/],
    forbidReadPaths: [/(^|\/)src\//],
    forbidWritePaths: [/(^|\/)requirements\.md$/, /(^|\/)progress\.(?:md|json)$/],
    message: 'Lean Reviewer: review injected diffs and plan evidence only',
  },
  'lean-verifier': {
    allowWritePaths: [/(^|\/)plan\.md$/],
    forbidReadPaths: [/(^|\/)src\//],
    forbidWritePaths: [/(^|\/)requirements\.md$/, /(^|\/)progress\.(?:md|json)$/],
    message: 'Lean Verifier: black-box test evidence only',
  },
  'hotfix-developer': {
    forbidWritePaths: [/(^|\/)progress\.(?:md|json)$/],
    forbidCommands: [/\bgit\s+(?:add|commit|push|merge|rebase|checkout|switch|branch)\b/],
    message: 'Hotfix Developer: cannot edit progress or mutate Git',
  },
  'hotfix-reviewer': {
    allowWritePaths: [/(^|\/)hotfix\.md$/],
    forbidReadPaths: [/(^|\/)src\//],
    forbidWritePaths: [/(^|\/)progress\.(?:md|json)$/],
    message: 'Hotfix Reviewer: review injected diff and write only the assigned Hotfix document',
  },
  'hotfix-verifier': {
    allowWritePaths: [/(^|\/)hotfix\.md$/],
    forbidReadPaths: [/(^|\/)src\//],
    forbidWritePaths: [/(^|\/)progress\.(?:md|json)$/],
    message: 'Hotfix Verifier: black-box evidence in the assigned Hotfix document only',
  },
};

const ROLE_ALIASES = {
  'lean-verifier-computer-use': 'lean-verifier',
  'hotfix-verifier-computer-use': 'hotfix-verifier',
};
const GIT_MUTATION = /\bgit(?:\s+-C\s+\S+)?\s+(?:add|commit|push|merge|rebase|checkout|switch|branch|reset|clean|cherry-pick|revert|tag|update-ref|worktree\s+(?:add|remove|move|prune|repair|lock|unlock))\b/;
const PROGRESS_PATH = /(?:^|[\\/\s"'])progress\.(?:md|json)(?=$|[\s"';&|)])/i;
const SHELL_FILE_MUTATION = /(?:^|[;&|]\s*)(?:rm|mv|cp|install|truncate)\b|\btee\b|\bsed\b[^\n]*(?:\s-i(?:\s|$)|--in-place)|\bperl\b[^\n]*\s-[^\s]*i[^\s]*|(?:^|[^<])>>?/i;

function matches(patterns, value) {
  return Boolean(patterns && value && patterns.some((pattern) => pattern.test(value)));
}

export function normalizeRole(role = '') {
  const unqualified = role.startsWith('cc-nexs.') ? role.slice('cc-nexs.'.length) : role;
  return ROLE_ALIASES[unqualified] || unqualified;
}

export function isGitMutation(command = '') {
  return GIT_MUTATION.test(command);
}

export function isProgressMutation(command = '') {
  return PROGRESS_PATH.test(command) && SHELL_FILE_MUTATION.test(command);
}

export function roleBoundaryViolation({ role, toolName = '', filePath = '', command = '', progressPath = null, cwd = process.cwd() }) {
  const normalizedRole = normalizeRole(role);
  const rule = DEFAULT_RULES[normalizedRole];
  if (!rule) return null;

  const normalizedTool = toolName.toLowerCase();
  const isWrite = ['edit', 'write', 'notebookedit'].includes(normalizedTool);
  const isRead = normalizedTool === 'read';

  let assignedHotfixDocument = null;
  if (isWrite && progressPath && ['hotfix-reviewer', 'hotfix-verifier'].includes(normalizedRole)) {
    try {
      const progressFile = resolve(cwd, progressPath);
      const progress = readProgressV2(progressFile);
      if (progress.mode !== 'hotfix') throw new Error('current task is not Hotfix');
      const document = resolveHotfixDocument(progress, dirname(progressFile));
      assignedHotfixDocument = realpathSync(document);
      if (realpathSync(resolve(cwd, filePath)) !== assignedHotfixDocument) {
        return `${rule.message} (write denied: ${filePath})`;
      }
    } catch (error) {
      return `${rule.message} (cannot resolve assigned document: ${error.message})`;
    }
  }
  if (isWrite && !assignedHotfixDocument && rule.allowWritePaths && !matches(rule.allowWritePaths, filePath)) {
    return `${rule.message} (write denied: ${filePath})`;
  }
  if (isWrite && matches(rule.forbidWritePaths, filePath)) {
    return `${rule.message} (path: ${filePath})`;
  }
  if (isRead && matches(rule.forbidReadPaths, filePath)) {
    return `${rule.message} (read denied: ${filePath})`;
  }
  if (command && matches(rule.forbidCommands, command)) {
    return `${rule.message} (command: ${command})`;
  }
  return null;
}
