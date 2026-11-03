import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { mergeRequestDriver } from './base-release.mjs';
import { findWorkspaceRoot, loadCandidateConfig } from './candidate-context.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import {
  cleanupMergedWorktree,
  commitCandidate,
  integrateCandidateToTest,
  promoteCandidateViaMergeRequest,
} from './git-custodian.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const LEAN_DOCS = ['requirements.md', 'plan.md', 'config.json', 'progress.md', 'progress.json'];
const LEGACY_HOTFIX_DOCS = ['hotfix.md', 'config.json', 'progress.md', 'progress.json'];

// Creates the single final docs candidate of a released task, integrates it
// into the docs base (through the configured MR driver when there is one), and
// removes the docs worktree and branches after remote proof. Reruns resume from
// Git state; nothing is written to progress after the candidate exists.
export function finalizeDocs({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const workspaceRoot = findWorkspaceRoot(cwd, progressFile);
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const docsId = workspace.docs_repository;
  if (!docsId) throw new Error('[cc-nexs] finalize-docs requires a configured docs repository');
  const repository = workspace.repositories.find((item) => item.id === docsId);
  const progress = readProgressV2(progressFile);
  if (progress.state !== 'COMPLETE' || progress.delivery?.base?.status !== 'succeeded') {
    throw new Error(`[cc-nexs] finalize-docs requires COMPLETE after a succeeded base release, found ${progress.state}`);
  }
  const assignment = progress.repositories?.[docsId];
  if (!assignment?.branch || !assignment?.worktree) throw new Error(`[cc-nexs] no docs worktree is assigned for ${progress.feature.id}`);
  const repo = repository.absolute_path;
  const worktree = resolve(workspaceRoot, assignment.worktree);
  const baseBranch = assignment.base_branch || repository.base_branch;
  const featureKey = progress.mode === 'hotfix' ? progress.feature.id : `${progress.feature.id}-${progress.feature.slug}`;
  const candidateRef = `refs/cc-nexs/candidates/${featureKey}/${docsId}`;
  const result = { kind: 'docs-finalize', feature: progress.feature, repository: docsId, branch: assignment.branch, progressFile };

  let created = false;
  if (!refExists(repo, candidateRef)) {
    if (!existsSync(worktree)) {
      if (!refExists(repo, `refs/heads/${assignment.branch}`)) return { ...result, status: 'merged', alreadyFinalized: true };
      throw new Error(`[cc-nexs] docs worktree ${assignment.worktree} is missing while ${assignment.branch} still exists`);
    }
    const paths = finalDocsPaths({ progress, progressFile, worktree });
    // Cleanup after the merge requires a clean worktree; refuse stray files
    // before anything is committed rather than merging and then getting stuck.
    const stray = execFileSync('git', ['-C', worktree, 'status', '--porcelain', '--untracked-files=all', '-z'], { encoding: 'utf8' })
      .split('\0').filter(Boolean).map((line) => line.slice(3)).filter((path) => !paths.includes(path));
    if (stray.length) {
      throw new Error(`[cc-nexs] docs worktree has changes outside the final docs (${stray.join(', ')}); move or remove them, then rerun finalize-docs`);
    }
    commitCandidate({
      repositoryId: docsId,
      repo,
      worktree,
      branch: assignment.branch,
      featureKey,
      paths,
      message: `docs: record ${progress.feature.id} ${progress.feature.slug} delivery`,
      progressFile,
      finalDocs: true,
    });
    created = true;
  }

  const mergeRequest = mergeRequestDriver(loadCandidateConfig(workspaceRoot), workspaceRoot);
  const integration = mergeRequest
    ? promoteCandidateViaMergeRequest({ repo, repositoryId: docsId, branch: assignment.branch, candidateRef, targetBranch: baseBranch, mergeRequest, checkSensitive: false })
    : integrateCandidateToTest({ repo, repositoryId: docsId, candidateRef, targetBranch: baseBranch });
  const sourceCommit = integration.sourceCommit;
  if (integration.pending) {
    return { ...result, status: 'pending', created, sourceCommit, mergeRequest: integration.mergeRequest };
  }
  const cleanup = cleanupMergedWorktree({ repo, worktree, branch: assignment.branch, baseBranch, candidateRef, deleteRemote: true });
  return {
    ...result,
    status: 'merged',
    created,
    sourceCommit,
    integrationCommit: integration.mergeCommit || integration.remoteCommit || integration.integrationCommit,
    mergeRequest: integration.mergeRequest || null,
    cleanup,
  };
}

// Lean (and promoted Lean) archives its five task files; a new Hotfix archives
// only its BUG document because machine state lives outside the docs repository;
// a legacy Hotfix keeps hotfix.md beside its original machine files.
function finalDocsPaths({ progress, progressFile, worktree }) {
  const root = realpathSync(worktree);
  const progressDir = realpathSync(dirname(progressFile));
  const rel = relative(root, progressDir);
  const inside = rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  const toGit = (path) => path.split(sep).join('/');
  if (!inside) {
    const document = progress.hotfix_document;
    if (progress.mode !== 'hotfix' || !document?.path) {
      throw new Error('[cc-nexs] the task state is outside the docs worktree and records no Hotfix BUG document');
    }
    if (!existsSync(join(root, document.path))) throw new Error(`[cc-nexs] Hotfix BUG document is missing: ${document.path}`);
    return [toGit(document.path)];
  }
  const names = progress.mode === 'lean' ? LEAN_DOCS : LEGACY_HOTFIX_DOCS;
  const present = names.filter((name) => existsSync(join(progressDir, name)));
  if (progress.mode === 'lean' && present.length !== names.length) {
    throw new Error(`[cc-nexs] final Lean docs require ${names.join(', ')}; missing ${names.filter((name) => !present.includes(name)).join(', ')}`);
  }
  return present.map((name) => toGit(rel ? join(rel, name) : name));
}

function refExists(repo, ref) {
  try {
    execFileSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', ref], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
