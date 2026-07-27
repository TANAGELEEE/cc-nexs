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
import {
  appendProgressEvent,
  approveProgressGate,
  hasProgressV2,
  progressJsonForMarkdown,
  readProgressV2,
} from './progress-v2.mjs';

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
  const re = new RegExp(`## ${escape(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  const fence = body.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
  if (fence) return parseSimpleYaml(fence[1]);
  // Allow plain `key: value` lines without code fence
  return parseSimpleYaml(body);
}

function extractAllYamlBlocks(text, heading) {
  const re = new RegExp(`## ${escape(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  const fences = [...body.matchAll(/```ya?ml\s*\n([\s\S]*?)\n```/g)];
  if (fences.length === 0) return parseSimpleYaml(body);
  const merged = {};
  for (const f of fences) {
    Object.assign(merged, parseSimpleYaml(f[1]));
  }
  return merged;
}

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseSimpleYaml(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      // Strip inline YAML comments (not inside quotes)
      if (!v.startsWith('"') && !v.startsWith("'")) {
        v = v.replace(/\s+#.*$/, '');
      }
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
  if (hasProgressV2(path)) {
    const progress = readProgressV2(progressJsonForMarkdown(path));
    const g2Sprints = Object.fromEntries(
      Object.entries(progress.gates?.g2?.sprints || {})
        .filter(([, value]) => value?.approved)
        .map(([key]) => [Number(key), true]),
    );
    return {
      raw: readFileSync(path, 'utf8'),
      keys: detectKeys(readFileSync(path, 'utf8')),
      current_state: progress.state,
      updated_at: progress.updated_at,
      counters: progress.counters || {},
      sprint: progress.sprint || {},
      gate: progress.gates || {},
      workflow: {
        g2_approved: progress.gates?.g2?.approved === true,
        g2_approved_sprints: g2Sprints,
        sprint_delivery: progress.delivery?.strategy || 'per_sprint',
        test_release: {
          policy: progress.delivery?.test?.policy || 'manual',
          status: progress.delivery?.test?.status || 'idle',
          attempt: progress.delivery?.test?.attempts?.length || 0,
        },
      },
      history: progress.events.map((event) => `${event.timestamp} ${event.from || '-'} → ${event.to || '-'}  ${event.reason || event.type}`),
      schema_version: 2,
      revision: progress.revision,
    };
  }
  const text = readFileSync(path, 'utf-8');
  const keys = detectKeys(text);
  const stateBlock = extractYamlBlock(text, keys.state) || {};
  const counters = extractYamlBlock(text, keys.counters) || {};
  const gate = extractAllYamlBlocks(text, keys.gate) || {};
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
    workflow: {
      g2_approved: gate.g2_approved === true,
      g2_approved_sprints: buildG2SprintMap(gate),
    },
    history,
  };
}

function buildG2SprintMap(gate) {
  const map = {};
  for (const [k, v] of Object.entries(gate)) {
    const m = k.match(/^g2_sprint_(\d+)_approved$/);
    if (m && v === true) map[parseInt(m[1], 10)] = true;
  }
  return map;
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
  if (hasProgressV2(path)) {
    appendProgressEvent(progressJsonForMarkdown(path), {
      type: 'state.transition', from, to, reason, actor: 'orchestrator',
    });
  }
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
  let ts = new Date().toISOString();
  if (hasProgressV2(path)) {
    const progress = approveProgressGate(progressJsonForMarkdown(path), { gate: 'g1', approver });
    ts = progress.gates.g1.approved_at;
  }
  const text = readFileSync(path, 'utf-8');
  let updated = setGateValue(text, 'human_approved_at', ts);
  updated = setGateValue(updated, 'human_approver', approver);
  writeFileSync(path, updated, 'utf-8');
  return { ts, approver };
}

export function approveDeployGate(path, { approver, sprint = null }) {
  let ts = new Date().toISOString();
  if (hasProgressV2(path)) {
    const progress = approveProgressGate(progressJsonForMarkdown(path), { gate: 'g2', approver, sprint });
    const approval = sprint === null
      ? progress.gates.g2
      : progress.gates.g2.sprints[String(sprint)];
    ts = approval.approved_at;
  }

  const text = readFileSync(path, 'utf-8');
  const approvalKey = sprint === null ? 'g2_approved' : `g2_sprint_${sprint}_approved`;
  let updated = setGateValue(text, approvalKey, 'true', { insertBefore: 'g2_approved_at' });
  updated = setGateValue(updated, 'g2_approved_at', ts);
  updated = setGateValue(updated, 'g2_approver', approver);
  writeFileSync(path, updated, 'utf-8');
  return { ts, approver, sprint };
}

function setGateValue(text, key, value, { insertBefore = null } = {}) {
  const line = `${key}: ${value}`;
  const keyRe = new RegExp(`^(\\s*${escape(key)}:\\s*).*$`, 'm');
  if (keyRe.test(text)) return text.replace(keyRe, `$1${value}`);

  if (insertBefore) {
    const beforeRe = new RegExp(`^(\\s*${escape(insertBefore)}:.*)$`, 'm');
    if (beforeRe.test(text)) return text.replace(beforeRe, `${line}\n$1`);
  }

  const keys = detectKeys(text);
  const gateRe = new RegExp(`(## ${escape(keys.gate)}[^\\n]*\\n)`);
  if (gateRe.test(text)) return text.replace(gateRe, `$1\n${line}\n`);
  return `${text.trimEnd()}\n\n## ${keys.gate}\n\n${line}\n`;
}
