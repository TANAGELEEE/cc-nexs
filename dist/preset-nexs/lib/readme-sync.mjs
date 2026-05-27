// cc-nexs core: per-feature README.md sync.
// Called by orchestrator after every transitionState() in run.md, and once at init.md.
//
// Contract:
//   syncFeatureReadme({ reqDir }) -> { updated, reason, warnings? }
//
//   - reason='no_readme'   when <reqDir>/README.md does not exist (minimal preset auto-skip)
//   - reason='no_anchor'   when README has no <!-- AUTOGEN:status START/END --> markers
//                          (legacy README; do NOT overwrite — caller may warn the user)
//   - reason='no_change'   when re-rendering produced byte-identical content (skip write)
//   - reason='synced'      when README was rewritten with fresh content
//
// Side-effects: writes <reqDir>/README.md when reason='synced'. Never throws on missing
// progress.md / git failure / acceptance parse — degrades gracefully.
//
// IMPORTANT: when adding a new artifact md to preset templates, register it in
// ARTIFACT_RULES + ARTIFACT_OWNERS below or it will be missing from 产物索引.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { readProgress } from './progress-io.mjs';

export const ANCHOR_START = '<!-- AUTOGEN:status START -->';
export const ANCHOR_END = '<!-- AUTOGEN:status END -->';

// Linear ordering of non-sprint states. Sprint states (SPRINT_<N>_*) are normalized to
// "after SPEC_APPROVED" so they sort correctly without enumerating each sub-phase.
const STATE_ORDER = [
  'INIT',
  'REQ_DRAFTED',
  'RECON_DONE',
  'SPEC_DRAFTED',
  'SPEC_REVIEWING',
  'SPEC_NEEDS_REVISION',
  'SPEC_PENDING_HUMAN',
  'SPEC_APPROVED',
  'BUILD',                     // fast mode
  'TEST',
  'TEST_BLOCKED',
  'FIX',
  'REGRESSION',
  'TEST_PASSED',
  'ACCEPT',
  'ACCEPT_NEEDS_REVISION',
  'ALL_SPRINTS_DONE',          // full mode
  'FINAL_EVAL',
  'COMPLETE',
];

function stateLevel(state) {
  if (!state) return -1;
  if (/^SPRINT_\d+_/.test(state)) return STATE_ORDER.indexOf('SPEC_APPROVED') + 1;
  return STATE_ORDER.indexOf(state);
}

function isAfterState(currentState, threshold) {
  const cur = stateLevel(currentState);
  const thr = stateLevel(threshold);
  return cur >= 0 && thr >= 0 && cur >= thr;
}

function conclusionPass(content) {
  if (!content) return false;
  const tail = content.split('\n').slice(-30).join('\n');
  return /^(?:结论:\s*PASS|结论:\s*通过|验收结果:\s*通过|Conclusion:\s*PASS)/m.test(tail);
}

// Per-artifact emoji rules. Order of evaluation per file:
//   1. conclusion (if rule has it AND file exists AND conclusionPass(content) → use)
//   2. afterState (if currentState >= threshold → use 'pass'; need exists check when threshold=COMPLETE)
//   3. inStates (if currentState ∈ list → use 'mid')
//   4. exists (if file exists → use)
//   5. otherwise (default ⚪)
const ARTIFACT_RULES = {
  'requirements.md':     { exists: '🟢', otherwise: '🟡' },
  'repo-context.md':     { afterState: 'RECON_DONE',     pass: '🟢', otherwise: '⚪' },
  'spec.md':             {
    afterState: 'SPEC_APPROVED', pass: '🟢',
    inStates: ['SPEC_DRAFTED', 'SPEC_REVIEWING', 'SPEC_NEEDS_REVISION'], mid: '🟡',
    otherwise: '⚪',
  },
  'sa-review.md':        { conclusion: '🟢', exists: '🟡', otherwise: '⚪' },
  'sa-test-review.md':   { conclusion: '🟢', exists: '🟡', otherwise: '⚪' },
  'sa-code-review.md':   { conclusion: '🟢', exists: '🟡', otherwise: '⚪' },
  'dev-plan.md':         { exists: '🟢', otherwise: '⚪' },
  'api-doc.md':          { afterState: 'COMPLETE', pass: '🟢', exists: '🟡', otherwise: '⚪' },
  'deploy.md':           { afterState: 'COMPLETE', pass: '🟢', exists: '🟡', otherwise: '⚪' },
  'test-cases.md':       { exists: '🟢', otherwise: '⚪' },
  'test-report.md':      { conclusion: '🟢', exists: '🟡', otherwise: '⚪' },
  'acceptance.md':       { conclusion: '🟢', exists: '🟡', otherwise: '⚪' },
  'compound-summary.md': { afterState: 'COMPLETE', pass: '🟢', exists: '🟢', otherwise: '⚪' },
};

const ARTIFACT_OWNERS = {
  'requirements.md':     'PM',
  'repo-context.md':     'Repo Scout',
  'spec.md':             'Planner',
  'sa-review.md':        'SA',
  'dev-plan.md':         'Tech Lead',
  'test-cases.md':       'QA',
  'sa-test-review.md':   'SA',
  'sa-code-review.md':   'SA',
  'api-doc.md':          'Tech Lead',
  'deploy.md':           'Tech Lead',
  'test-report.md':      'QA',
  'acceptance.md':       'Evaluator',
  'compound-summary.md': 'Compound',
};

function fileEmojiForArtifact(filename, currentState, reqDir) {
  const rule = ARTIFACT_RULES[filename];
  if (!rule) return '⚪';
  const fp = join(reqDir, filename);
  const exists = existsSync(fp);
  const content = exists ? safeRead(fp) : '';

  if (rule.conclusion && exists && conclusionPass(content)) return rule.conclusion;
  if (rule.afterState && rule.pass && isAfterState(currentState, rule.afterState)) {
    if (rule.afterState === 'COMPLETE' && !exists) {
      return rule.exists || rule.otherwise || '⚪';
    }
    return rule.pass;
  }
  if (rule.inStates && rule.inStates.includes(currentState)) return rule.mid || '⚪';
  if (rule.exists && exists) return rule.exists;
  return rule.otherwise || '⚪';
}

function safeRead(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function fileLastUpdated(filename, reqDir) {
  const fp = join(reqDir, filename);
  if (!existsSync(fp)) return '-';
  // Prefer git log so the timestamp reflects intentional commits, not local touch.
  try {
    const ts = execSync(`git log -1 --format='%ai' -- "${fp}"`, {
      cwd: reqDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (ts) return ts.split(' ')[0];
  } catch { /* git unavailable / file untracked — fall through */ }
  // Fallback: filesystem mtime (initial RECON state where file isn't committed yet)
  try {
    const m = statSync(fp).mtime;
    return m.toISOString().split('T')[0];
  } catch { return '-'; }
}

function getCurrentBranch(reqDir) {
  try {
    return execSync('git branch --show-current', {
      cwd: reqDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim() || '(detached)';
  } catch { return '(unknown)'; }
}

function renderStatusBlock(progress, reqDir) {
  const stage = progress.current_state || 'INIT';
  const sprintCur = progress.sprint?.current_sprint ?? 0;
  const sprintTotal = progress.sprint?.total_sprints ?? 0;
  const sprintLabel = sprintTotal > 0 ? `M${sprintCur} / M${sprintTotal}` : '未启动';
  const branch = getCurrentBranch(reqDir);
  const lastTs = (progress.history && progress.history.length > 0)
    ? (progress.history[progress.history.length - 1].split(' ')[0] || '-')
    : (progress.updated_at ? progress.updated_at.split('T')[0] : '-');
  return [
    '## 当前状态',
    '',
    `- **整体阶段**：${stage}`,
    `- **当前 Sprint**：${sprintLabel}`,
    `- **分支**：${branch}`,
    `- **最近更新**：${lastTs}`,
  ].join('\n');
}

function renderArtifactIndex(currentState, reqDir) {
  const rows = ['| 文件 | 负责人 | 状态 | 最近更新 |', '|------|--------|------|---------|'];
  for (const [filename, owner] of Object.entries(ARTIFACT_OWNERS)) {
    const emoji = fileEmojiForArtifact(filename, currentState, reqDir);
    const ts = fileLastUpdated(filename, reqDir);
    rows.push(`| ${filename} | ${owner} | ${emoji} | ${ts} |`);
  }
  return ['## 产物索引', '', ...rows, '', '**图例**：🟢 完成 / 🟡 进行中 / ⚪ 未开始'].join('\n');
}

function renderAcceptanceSnapshot(reqDir) {
  const fp = join(reqDir, 'acceptance.md');
  const header = ['## 契约覆盖快照', '', '| Sprint | 验收结果 |', '|--------|---------|'];
  if (!existsSync(fp)) {
    return [...header, '| - | acceptance.md 尚未产出 |'].join('\n');
  }
  const content = safeRead(fp);
  const matches = [...content.matchAll(/^##\s+Sprint\s+(M\d+)/gm)];
  const rows = [];
  for (let i = 0; i < matches.length; i += 1) {
    const sprint = matches[i][1];
    const fromIdx = matches[i].index;
    const toIdx = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const block = content.slice(fromIdx, toIdx);
    const concl = block.match(/^验收结果:\s*(\S+)/m);
    rows.push(`| ${sprint} | ${concl ? concl[1] : '进行中'} |`);
  }
  // Also pick up cross-sprint final verdict if present (FINAL_EVAL stage)
  const finalConcl = content.match(/##\s+(?:最终验收|Final Acceptance)[\s\S]*?^验收结果:\s*(\S+)/m);
  if (finalConcl) rows.push(`| FINAL | ${finalConcl[1]} |`);
  if (rows.length === 0) rows.push('| - | acceptance.md 待填 |');
  return [...header, ...rows].join('\n');
}

function renderHumanRequired(progressText) {
  const m = progressText.match(/##\s+(?:待人工接入|Human Required)\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/);
  let body = m ? m[1].trim() : '';
  // Strip HTML comment hints from template that aren't real entries
  body = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!body || body === '- (尚无)') body = '- (尚无)';
  return ['## 待人工接入（来自 progress.md）', '', body].join('\n');
}

export function syncFeatureReadme({ reqDir }) {
  const readmePath = join(reqDir, 'README.md');
  if (!existsSync(readmePath)) {
    return { updated: false, reason: 'no_readme' };
  }
  const original = safeRead(readmePath);
  if (!original.includes(ANCHOR_START) || !original.includes(ANCHOR_END)) {
    return { updated: false, reason: 'no_anchor' };
  }

  const progressPath = join(reqDir, 'progress.md');
  const progress = readProgress(progressPath) || { current_state: 'INIT', sprint: {}, history: [] };
  const progressText = existsSync(progressPath) ? safeRead(progressPath) : '';

  const block = [
    '<!-- 此区段由 orchestrator 自动维护，请勿手动编辑（编辑会被覆盖） -->',
    '',
    renderStatusBlock(progress, reqDir),
    '',
    renderArtifactIndex(progress.current_state, reqDir),
    '',
    renderAcceptanceSnapshot(reqDir),
    '',
    renderHumanRequired(progressText),
  ].join('\n');

  const startIdx = original.indexOf(ANCHOR_START);
  const endIdx = original.indexOf(ANCHOR_END);
  const before = original.slice(0, startIdx + ANCHOR_START.length);
  const after = original.slice(endIdx);
  const next = `${before}\n${block}\n${after}`;

  if (next === original) {
    return { updated: false, reason: 'no_change' };
  }
  writeFileSync(readmePath, next, 'utf-8');
  return { updated: true, reason: 'synced' };
}

// Exported only for tests.
export const __test__ = {
  ARTIFACT_RULES,
  ARTIFACT_OWNERS,
  STATE_ORDER,
  stateLevel,
  isAfterState,
  conclusionPass,
  fileEmojiForArtifact,
};
