// cc-nexs core: progress.md I/O.
// progress.md is human-readable Markdown but contains structured YAML blocks.
// We parse / serialize the YAML blocks; the surrounding prose is preserved verbatim.
//
// Sections recognized (by `## <heading>` line):
//   - 当前状态 / Current State : YAML block with current_state, updated_at
//   - 计数器 / Counters        : YAML block with counters
//   - Sprint 进度 / Sprint Progress : YAML block
//   - 人工 gate / Human Gate   : YAML block with approved_at, approver
//   - 历史轨迹 / History       : list of `- <ts> <from> → <to>  <reason>` lines
//   - 待人工接入 / Human Required : list

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SECTION_KEYS_ZH = {
  state: '当前状态',
  counters: '计数器',
  sprint: 'Sprint 进度',
  gate: '人工 gate',
  history: '历史轨迹',
  human_required: '待人工接入',
};
const SECTION_KEYS_EN = {
  state: 'Current State',
  counters: 'Counters',
  sprint: 'Sprint Progress',
  gate: 'Human Gate',
  history: 'History',
  human_required: 'Human Required',
};

function detectKeys(text) {
  return text.includes('## 当前状态') ? SECTION_KEYS_ZH : SECTION_KEYS_EN;
}

function extractYamlBlock(text, heading) {
  const re = new RegExp(`## ${escape(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n# |$)`);
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  const fence = body.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
  if (fence) return parseSimpleYaml(fence[1]);
  // Allow plain `key: value` lines without code fence
  return parseSimpleYaml(body);
}

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseSimpleYaml(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) {
      const v = m[2].trim();
      if (v === '' || v === 'null' || v === '~') out[m[1]] = null;
      else if (/^-?\d+$/.test(v)) out[m[1]] = parseInt(v, 10);
      else if (v === 'true') out[m[1]] = true;
      else if (v === 'false') out[m[1]] = false;
      else out[m[1]] = v.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

export function readProgress(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  const keys = detectKeys(text);
  const stateBlock = extractYamlBlock(text, keys.state) || {};
  const counters = extractYamlBlock(text, keys.counters) || {};
  const gate = extractYamlBlock(text, keys.gate) || {};
  const sprint = extractYamlBlock(text, keys.sprint) || {};
  const history = parseHistory(text, keys.history);

  return {
    raw: text,
    keys,
    current_state: stateBlock.current_state || 'INIT',
    updated_at: stateBlock.updated_at || null,
    counters,
    sprint,
    gate,
    history,
  };
}

function parseHistory(text, heading) {
  const re = new RegExp(`## ${escape(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n# |$)`);
  const m = text.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => l.replace(/^-\s+/, ''));
}

/**
 * Update progress.md current_state + updated_at + history append.
 * Preserves all other content verbatim.
 */
export function transitionState(path, { from, to, reason = '' }) {
  const text = readFileSync(path, 'utf-8');
  const keys = detectKeys(text);
  const ts = new Date().toISOString();

  // Replace current_state in state block
  let updated = text.replace(
    /(current_state:\s*)\S+/,
    `$1${to}`,
  );
  updated = updated.replace(
    /(updated_at:\s*)\S+/,
    `$1${ts}`,
  );
  if (!updated.includes('updated_at:')) {
    updated = updated.replace(/(current_state:.*\n)/, `$1updated_at: ${ts}\n`);
  }

  // Append history line
  const histHeading = `## ${keys.history}`;
  const histLine = `- ${ts} ${from} → ${to}${reason ? '  ' + reason : ''}`;
  const histRe = new RegExp(`(## ${escape(keys.history)}[^\\n]*\\n(?:[^\\n]*\\n)*?)((?=\\n## |\\n# |$))`);
  if (histRe.test(updated)) {
    updated = updated.replace(histRe, `$1${histLine}\n$2`);
  } else {
    updated += `\n${histHeading}\n\n${histLine}\n`;
  }

  writeFileSync(path, updated, 'utf-8');
  return { ts, from, to };
}

export function approveHumanGate(path, { approver }) {
  const text = readFileSync(path, 'utf-8');
  const keys = detectKeys(text);
  const ts = new Date().toISOString();
  let updated = text;
  // Replace approved_at and approver under gate section
  updated = updated.replace(/(approved_at:\s*)\S+/, `$1${ts}`);
  updated = updated.replace(/(approver:\s*)\S+/, `$1${approver}`);
  if (!updated.includes('approved_at:')) {
    const gateRe = new RegExp(`(## ${escape(keys.gate)}[^\\n]*\\n)`);
    updated = updated.replace(gateRe, `$1\napproved_at: ${ts}\napprover: ${approver}\n\n`);
  }
  writeFileSync(path, updated, 'utf-8');
  return { ts, approver };
}
