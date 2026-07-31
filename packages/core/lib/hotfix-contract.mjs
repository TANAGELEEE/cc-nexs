import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const HOTFIX_SCOPE_MARKERS = {
  start: '<!-- HOTFIX-SCOPE START -->',
  end: '<!-- HOTFIX-SCOPE END -->',
};

const SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const ESCAPE_FIELDS = ['acceptance_contract_change', 'api_contract_change', 'database_schema_change', 'permission_model_change', 'broad_refactor'];

export function extractHotfixScope(text) {
  const start = text.indexOf(HOTFIX_SCOPE_MARKERS.start);
  const end = text.indexOf(HOTFIX_SCOPE_MARKERS.end);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[cc-nexs] hotfix.md must contain one ordered HOTFIX-SCOPE marker pair');
  }
  if (text.indexOf(HOTFIX_SCOPE_MARKERS.start, start + 1) !== -1 || text.indexOf(HOTFIX_SCOPE_MARKERS.end, end + 1) !== -1) {
    throw new Error('[cc-nexs] hotfix.md must contain exactly one HOTFIX-SCOPE marker pair');
  }
  const raw = text.slice(start + HOTFIX_SCOPE_MARKERS.start.length, end).trim();
  if (!raw) throw new Error('[cc-nexs] hotfix scope is empty');
  const fields = Object.fromEntries([...raw.matchAll(/^[-*]\s+([a-z_]+):\s*(.*?)\s*$/gm)].map((match) => [match[1], match[2]]));
  const severity = String(fields.severity || '').toUpperCase();
  if (!SEVERITIES.has(severity)) throw new Error('[cc-nexs] hotfix scope severity must be P0, P1, P2, or P3');
  for (const field of ESCAPE_FIELDS) {
    if (!['no', 'false'].includes(String(fields[field] || '').toLowerCase())) {
      throw new Error(`[cc-nexs] ${field} must be no; this change must use lean/full instead of hotfix`);
    }
  }
  const nonBehavioral = ['yes', 'true'].includes(String(fields.non_behavioral_change || '').toLowerCase());
  if (severity === 'P3' && !nonBehavioral) {
    throw new Error('[cc-nexs] P3 requires non_behavioral_change: yes');
  }
  if (severity !== 'P3' && nonBehavioral) {
    throw new Error('[cc-nexs] non_behavioral_change: yes is reserved for P3');
  }
  return {
    raw,
    severity,
    relatedFeature: fields.related_feature && fields.related_feature !== '-' ? fields.related_feature : null,
    nonBehavioral,
  };
}

export function hotfixScopeBinding(featureDir) {
  const file = join(featureDir, 'hotfix.md');
  if (!existsSync(file)) throw new Error(`[cc-nexs] missing hotfix document: ${file}`);
  const scope = extractHotfixScope(readFileSync(file, 'utf8'));
  return {
    hotfix_scope_sha256: createHash('sha256').update(scope.raw).digest('hex'),
    severity: scope.severity,
    related_feature: scope.relatedFeature,
    file: 'hotfix.md',
  };
}

export function assertHotfixScopeCurrent(progress, featureDir) {
  if (progress.mode !== 'hotfix') throw new Error(`[cc-nexs] hotfix scope requires hotfix mode, found ${progress.mode}`);
  if (!progress.hotfix?.scope_binding) throw new Error('[cc-nexs] hotfix scope has not been bound');
  const current = hotfixScopeBinding(featureDir);
  if (current.hotfix_scope_sha256 !== progress.hotfix.scope_binding.hotfix_scope_sha256) {
    throw new Error('[cc-nexs] hotfix scope changed after binding; restart as a new hotfix or convert to lean/full');
  }
  if (current.severity !== progress.hotfix.severity || current.related_feature !== (progress.hotfix.related_feature || null)) {
    throw new Error('[cc-nexs] hotfix classification changed after binding');
  }
  return current;
}

export function assertP3CandidateBoundary(context) {
  if (context.progress.hotfix?.severity !== 'P3') return null;
  assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
  let files = 0;
  let lines = 0;
  const details = [];
  for (const item of context.repositories) {
    const base = item.assignment.base_commit;
    if (!base) throw new Error(`[cc-nexs] P3 requires recorded latest-base commit for ${item.id}`);
    const output = execFileSync('git', ['diff', '--numstat', base, item.sourceCommit], {
      cwd: item.repository.absolute_path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    for (const line of output ? output.split('\n') : []) {
      const [added, deleted, path] = line.split('\t');
      if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted)) throw new Error('[cc-nexs] binary changes are not eligible for P3');
      files += 1;
      lines += Number(added) + Number(deleted);
      details.push({ repository: item.id, path, added: Number(added), deleted: Number(deleted) });
    }
  }
  if (files !== 1 || lines > 20) {
    throw new Error(`[cc-nexs] P3 requires exactly one changed file and at most 20 changed lines; found ${files} files / ${lines} lines`);
  }
  return { files, lines, details };
}
