import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findWorkspaceRoot } from './candidate-context.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { cleanupMergedWorktree, createWorkspaceWorktrees } from './git-custodian.mjs';
import { resolveHotfixDocument } from './hotfix-contract.mjs';
import { createProgressV2, readProgressV2, recordRepositoryAssignments, writeProgressV2 } from './progress-v2.mjs';

export function hotfixTemplates(mode = 'hotfix') {
  const root = process.env.CC_NEXS_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || process.env.PLUGIN_ROOT;
  const paths = [root && join(root, 'templates', mode), fileURLToPath(new URL(`../templates/${mode}`, import.meta.url)), fileURLToPath(new URL(`../../preset-standard/templates/${mode}`, import.meta.url))].filter(Boolean);
  const found = paths.find((path) => existsSync(path));
  if (!found) throw new Error(`[cc-nexs] ${mode} templates not found`);
  return found;
}

export function initializeHotfix({ cwd = process.cwd(), slug, description, bugKey = null, relatedFeature = null, repositoryIds = [], bugFile = null } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) throw new Error('[cc-nexs] Hotfix slug must be lowercase letters, digits, and hyphens');
  if (typeof description !== 'string' || !description.trim()) throw new Error('[cc-nexs] Hotfix description is required');
  const key = bugKey || `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${slug}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) throw new Error('[cc-nexs] invalid BUG key');
  if (relatedFeature !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(relatedFeature))) throw new Error('[cc-nexs] invalid related feature');
  if (bugFile && (isAbsolute(bugFile) || bugFile.split(/[\\/]/).some((part) => ['..', '.'].includes(part)) || !bugFile.endsWith('.md'))) throw new Error('[cc-nexs] BUG file must be a safe docs-relative Markdown path');
  const root = findWorkspaceRoot(cwd);
  const workspace = loadWorkspaceConfig({ projectRoot: root });
  if (!workspace.docs_repository) throw new Error('[cc-nexs] Hotfix requires a configured docs repository');
  const stateDir = join(root, '.cc-nexs', 'hotfixes', key);
  const progressFile = join(stateDir, 'progress.json');
  if (existsSync(progressFile)) {
    const progress = readProgressV2(progressFile);
    if (progress.feature.slug !== slug || progress.mode !== 'hotfix') throw new Error('[cc-nexs] BUG key belongs to another task');
    const document = resolveHotfixDocument(progress, stateDir);
    if (!existsSync(document) || !progress.repositories?.[workspace.docs_repository]?.branch || !existsSync(join(stateDir, 'config.json')) || !existsSync(join(stateDir, 'progress.md'))) throw new Error('[cc-nexs] incomplete Hotfix initialization; inspect the recorded task before resuming');
    return { kind: 'hotfix-init', feature: progress.feature, progressFile, document, resumed: true };
  }
  if (existsSync(stateDir)) throw new Error('[cc-nexs] incomplete Hotfix initialization; inspect the existing state directory before retrying');
  const templateRoot = hotfixTemplates();
  const template = readFileSync(join(templateRoot, 'hotfix.md'), 'utf8');
  const config = readFileSync(join(templateRoot, 'config.json'), 'utf8');
  const markdown = readFileSync(join(templateRoot, 'progress.md'), 'utf8').replaceAll('{编号}', key).replaceAll('{需求短名}', slug);
  const selected = [...new Set([workspace.docs_repository, ...repositoryIds])];
  mkdirSync(dirname(stateDir), { recursive: true });
  mkdirSync(stateDir);
  let assignments = [];
  let createdDocument = null;
  try {
    assignments = createWorkspaceWorktrees(workspace, { featureId: key, featureSlug: slug, repositoryIds: selected, mode: 'hotfix' });
    const docs = assignments.find((item) => item.repository === workspace.docs_repository);
    let documentPath = bugFile;
    if (!documentPath && relatedFeature !== null) {
      const dir = join(docs.worktree, 'doc');
      const matching = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(`${relatedFeature}.`)) : [];
      if (matching.length !== 1) throw new Error('[cc-nexs] related feature must identify one existing docs directory; use --bug-file to resolve ambiguity');
      documentPath = `doc/${matching[0]}/bugs/BUG-${key}.md`;
    }
    documentPath ||= `hotfix/${key}/BUG-001.md`;
    const document = resolveHotfixDocument({ hotfix_document: { repository: workspace.docs_repository, path: documentPath }, repositories: { [workspace.docs_repository]: { worktree: relative(root, docs.worktree) } } }, stateDir);
    if (existsSync(document)) throw new Error('[cc-nexs] BUG document already exists; resume its recorded task instead');
    mkdirSync(dirname(document), { recursive: true });
    const body = template.replaceAll('{编号}', key).replaceAll('{需求短名}', slug)
      .replace('- 现象：', `- 现象：${description.trim()}`).replace('related_feature: -', `related_feature: ${relatedFeature || '-'}`);
    writeFileSync(document, body, { flag: 'wx' });
    createdDocument = { path: document, body };
    writeFileSync(join(stateDir, 'config.json'), config);
    writeFileSync(join(stateDir, 'progress.md'), markdown);
    const progress = createProgressV2({ featureId: key, featureSlug: slug, preset: 'preset-standard', mode: 'hotfix' });
    progress.hotfix_document = { repository: workspace.docs_repository, path: documentPath };
    const preparedFile = join(stateDir, 'progress.initializing.json');
    writeProgressV2(preparedFile, progress);
    recordRepositoryAssignments(preparedFile, assignments, { workspaceRoot: root });
    renameSync(preparedFile, progressFile);
    return { kind: 'hotfix-init', feature: progress.feature, progressFile, document, assignments, reserved: false };
  } catch (error) {
    if (createdDocument && existsSync(createdDocument.path) && readFileSync(createdDocument.path, 'utf8') === createdDocument.body) rmSync(createdDocument.path);
    const retained = [];
    for (const item of assignments.reverse()) {
      try { cleanupMergedWorktree({ repo: item.source, worktree: item.worktree, branch: item.branch, baseBranch: item.baseBranch }); }
      catch { retained.push(item.worktree); }
    }
    rmSync(stateDir, { recursive: true, force: true });
    throw new Error(`${error.message}${retained.length ? `; preserved worktrees requiring inspection: ${retained.join(', ')}` : ''}`);
  }
}
