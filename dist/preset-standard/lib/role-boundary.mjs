const CODEX_COMMAND = /(?:^|[;&|]\s*)(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*codex(?:\s|$)/;

const DEFAULT_RULES = {
  planner: {
    forbidWritePaths: [/(^|\/)src\//, /(^|\/)progress\.md$/],
    forbidCommands: [/\bmvn\b/, CODEX_COMMAND, /\bgit\s+commit\b/],
    message: 'Planner role: cannot write code or run build/review commands',
  },
  'tech-lead': {
    forbidWritePaths: [/\/(spec|acceptance|sa-review|sa-code-review|sa-test-review|test-report)\.md$/, /(^|\/)progress\.md$/],
    message: 'Tech Lead role: cannot edit spec / acceptance / review / test-report / progress',
  },
  qa: {
    forbidReadPaths: [/(^|\/)src\/(main|test)\//, /\/sa-review\.md$/, /\/sa-code-review\.md$/],
    message: 'QA role: black-box; cannot read src/ or sa-*.md',
  },
  evaluator: {
    forbidReadPaths: [/(^|\/)src\//, /\/sa-.*\.md$/, /\/dev-plan\.md$/],
    message: 'Evaluator role: cannot read src/, sa-*, dev-plan.md',
  },
  reviewer: {
    forbidReadPaths: [/(^|\/)src\//, /\/dev-plan\.md$/],
    message: 'Reviewer role (fast): cannot read src/ or dev-plan.md',
  },
  verifier: {
    forbidReadPaths: [/(^|\/)src\/(main|test)\//, /\/sa-review\.md$/, /\/sa-code-review\.md$/, /\/sa-test-review\.md$/],
    message: 'Verifier role (fast): black-box; cannot read src/ or sa-*.md',
  },
  fullstack: {
    forbidWritePaths: [/(^|\/)progress\.md$/, /\/acceptance\.md$/, /\/sa-.*\.md$/, /\/test-report\.md$/],
    message: 'Fullstack role (fast): cannot edit progress / acceptance / sa-* / test-report',
  },
  'lean-planner': {
    allowWritePaths: [/(^|\/)(?:requirements|plan)\.md$/],
    forbidWritePaths: [/(^|\/)src\//, /(^|\/)progress\.(?:md|json)$/],
    forbidCommands: [CODEX_COMMAND, /\bgit\s+(?:add|commit|push|merge|rebase|checkout|switch|branch)\b/],
    message: 'Lean Planner: may write requirements/plan only, never code, progress, or Git state',
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
    message: 'Hotfix Reviewer: review injected diff and hotfix.md only',
  },
  'hotfix-verifier': {
    allowWritePaths: [/(^|\/)hotfix\.md$/],
    forbidReadPaths: [/(^|\/)src\//],
    forbidWritePaths: [/(^|\/)progress\.(?:md|json)$/],
    message: 'Hotfix Verifier: black-box evidence in hotfix.md only',
  },
};

const ROLE_ALIASES = { pm: 'planner', developer: 'tech-lead', dev: 'tech-lead' };
const GIT_MUTATION = /\bgit(?:\s+-C\s+\S+)?\s+(?:add|commit|push|merge|rebase|checkout|switch|branch|reset|clean|cherry-pick|revert|tag|update-ref|worktree\s+(?:add|remove|move|prune|repair|lock|unlock))\b/;

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

export function roleBoundaryViolation({ role, toolName = '', filePath = '', command = '' }) {
  const normalizedRole = normalizeRole(role);
  const rule = DEFAULT_RULES[normalizedRole];
  if (!rule) return null;

  const normalizedTool = toolName.toLowerCase();
  const isWrite = ['edit', 'write', 'notebookedit'].includes(normalizedTool);
  const isRead = normalizedTool === 'read';

  if (isWrite && rule.allowWritePaths && !matches(rule.allowWritePaths, filePath)) {
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
