import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';

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
      throw new Error(`[cc-nexs] ${field} must be no; this change must use lean instead of hotfix`);
    }
  }
  const nonBehavioral = ['yes', 'true'].includes(String(fields.non_behavioral_change || '').toLowerCase());
  const intendedPaths = String(fields.intended_paths || '').split(',').map((path) => path.trim()).filter(Boolean);
  if (!intendedPaths.length || intendedPaths.some((path) => path === '-' || isAbsolute(path) || path.split('/').includes('..'))) {
    throw new Error('[cc-nexs] intended_paths must name repository-relative repair paths');
  }
  if (['P0', 'P1'].includes(severity)) {
    for (const field of ['affected_acs', 'rollback_owner', 'rollback_steps']) {
      if (!fields[field]?.trim() || fields[field].trim() === '-') throw new Error(`[cc-nexs] ${severity} requires ${field}`);
    }
  }
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
    intendedPaths,
  };
}

export function resolveHotfixDocument(progress, featureDir) {
  if (!progress?.hotfix_document) return join(featureDir, 'hotfix.md');
  const { repository, path } = progress.hotfix_document;
  const worktree = progress.repositories?.[repository]?.worktree;
  if (typeof path !== 'string' || !path.endsWith('.md') || isAbsolute(path) || path.split(/[\\/]/).includes('..') || !worktree) {
    throw new Error('[cc-nexs] invalid Hotfix BUG document assignment');
  }
  let root = resolve(featureDir);
  while (!existsSync(join(root, '.cc-nexs', 'workspace.yml')) && !existsSync(join(root, '.cc-nexs', 'workspace.json'))) {
    const parent = dirname(root);
    if (parent === root) throw new Error('[cc-nexs] Hotfix workspace root not found');
    root = parent;
  }
  const docsRoot = realpathSync(resolve(root, worktree));
  let parent = docsRoot;
  for (const part of path.split(/[\\/]/)) {
    parent = join(parent, part);
    try {
      if (lstatSync(parent).isSymbolicLink()) throw new Error('[cc-nexs] BUG document must not traverse symbolic links');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const file = resolve(docsRoot, path);
  const rel = relative(docsRoot, existsSync(file) ? realpathSync(file) : file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('[cc-nexs] BUG document escapes its docs worktree');
  return file;
}

export function hotfixScopeBinding(featureDir, progress = null) {
  const file = resolveHotfixDocument(progress, featureDir);
  if (!existsSync(file)) throw new Error(`[cc-nexs] missing hotfix document: ${file}`);
  const scope = extractHotfixScope(readFileSync(file, 'utf8'));
  return {
    hotfix_scope_sha256: createHash('sha256').update(scope.raw).digest('hex'),
    severity: scope.severity,
    related_feature: scope.relatedFeature,
    file: progress?.hotfix_document?.path || 'hotfix.md',
  };
}

export function assertHotfixScopeCurrent(progress, featureDir) {
  if (progress.mode !== 'hotfix') throw new Error(`[cc-nexs] hotfix scope requires hotfix mode, found ${progress.mode}`);
  if (!progress.hotfix?.scope_binding) throw new Error('[cc-nexs] hotfix scope has not been bound');
  const current = hotfixScopeBinding(featureDir, progress);
  if (current.hotfix_scope_sha256 !== progress.hotfix.scope_binding.hotfix_scope_sha256 || current.file !== (progress.hotfix.scope_binding.file || 'hotfix.md')) {
    throw new Error('[cc-nexs] hotfix scope changed after binding; use revise-hotfix with the user authorization, or --promote-lean for a contract change');
  }
  if (current.severity !== progress.hotfix.severity || current.related_feature !== (progress.hotfix.related_feature || null)) {
    throw new Error('[cc-nexs] hotfix classification changed after binding');
  }
  return current;
}

export function assertHotfixCandidatePaths(context) {
  const scope = extractHotfixScope(readFileSync(resolveHotfixDocument(context.progress, dirname(context.progressFile)), 'utf8'));
  for (const item of context.repositories) {
    if (!item.assignment.base_commit) throw new Error(`[cc-nexs] missing Hotfix base commit for ${item.id}`);
    const gitOptions = { cwd: item.repository.absolute_path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
    const remoteBase = `refs/remotes/origin/${item.assignment.base_branch}`;
    let remoteBaseExists = false;
    try {
      execFileSync('git', ['show-ref', '--verify', '--quiet', remoteBase], gitOptions);
      remoteBaseExists = true;
    } catch { /* Legacy repositories may have no remote-tracking base ref. */ }
    const base = remoteBaseExists
      ? execFileSync('git', ['merge-base', item.sourceCommit, remoteBase], gitOptions).trim()
      : item.assignment.base_commit;
    const paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, item.sourceCommit], gitOptions).split('\0').filter(Boolean);
    const allowed = scope.intendedPaths.filter((path) => path.startsWith(`${item.id}/`)).map((path) => path.slice(item.id.length + 1));
    // Legacy single-repository documents used unqualified paths.
    if (context.repositories.length === 1 && !allowed.length) allowed.push(...scope.intendedPaths);
    const outside = paths.filter((path) => !implementationPathAllowed(path, allowed));
    if (outside.length) throw new Error(`[cc-nexs] Hotfix candidate is outside intended_paths: ${item.id}/${outside.join(', ')}; record authorized scope with revise-hotfix`);
  }
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

function globExpression(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`);
}

function implementationPathAllowed(path, allowedPaths) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return allowedPaths.some((allowedPath) => {
    const pattern = allowedPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern === '.') return true;
    if (!/[*?]/.test(pattern)) return normalized === pattern || normalized.startsWith(`${pattern}/`);
    return globExpression(pattern).test(normalized);
  });
}
