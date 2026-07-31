import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { resolveCandidateCommit } from './git-custodian.mjs';
import { readProgressV2 } from './progress-v2.mjs';

export function resolveCandidateContext({ cwd = process.cwd(), featureId, progressPath = null, includeDocs = false } = {}) {
  if (!featureId) throw new Error('feature id is required');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const workspaceRoot = findWorkspaceRoot(cwd, progressFile);
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const pluginRoot = process.env.CC_NEXS_PLUGIN_ROOT
    || process.env.CLAUDE_PLUGIN_ROOT
    || process.env.CODEX_PLUGIN_ROOT
    || process.env.PLUGIN_ROOT
    || null;
  const config = loadConfig({ projectRoot: workspaceRoot, ...(pluginRoot && { presetRoot: pluginRoot }) });
  const progress = readProgressV2(progressFile);
  const workspaceById = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  const repositories = [];
  for (const [id, assignment] of Object.entries(progress.repositories || {})) {
    if (!assignment?.candidate?.ref) continue;
    const repository = workspaceById.get(id);
    if (!repository) throw new Error(`[cc-nexs] assigned repository is missing from workspace config: ${id}`);
    const isDocs = repository.docs === true || id === workspace.docs_repository;
    if (isDocs && !includeDocs) continue;
    repositories.push({
      id,
      repository,
      assignment,
      isDocs,
      sourceCommit: resolveCandidateCommit({ repo: repository.absolute_path, candidateRef: assignment.candidate.ref }),
    });
  }
  repositories.sort((left, right) => {
    if (left.isDocs !== right.isDocs) return left.isDocs ? 1 : -1;
    return left.repository.release_order - right.repository.release_order || left.id.localeCompare(right.id);
  });
  if (repositories.length === 0) throw new Error('[cc-nexs] no candidate repositories are ready');
  return {
    progressFile,
    workspaceRoot,
    workspace,
    config,
    progress,
    repositories,
    source: Object.fromEntries(repositories.map((item) => [item.id, item.sourceCommit])),
  };
}

export function findWorkspaceRoot(cwd, progressFile = null) {
  for (const start of [cwd, progressFile ? dirname(progressFile) : null].filter(Boolean)) {
    let current = resolve(start);
    while (true) {
      if (existsSync(join(current, '.cc-nexs', 'workspace.yml')) || existsSync(join(current, '.cc-nexs', 'workspace.json'))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('[cc-nexs] workspace root not found');
}
