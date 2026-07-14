import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function assertIdentity(value, label) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value || '')) throw new Error(`[cc-nexs] invalid ${label}: ${value}`);
  return value;
}

function reservationPath(workspace, featureId) {
  return join(workspace.projectRoot, '.cc-nexs', 'reservations', `${featureId}.json`);
}

function featureExistsInDocs(workspace, featureId) {
  const docs = workspace.repositories.find((repo) => repo.id === workspace.docs_repository);
  const root = docs && join(docs.absolute_path, 'doc');
  return Boolean(root && existsSync(root) && readdirSync(root).some((name) => name.startsWith(`${featureId}.`)));
}

function featureExistsInWorktrees(workspace, featureId) {
  return existsSync(workspace.worktree_root)
    && readdirSync(workspace.worktree_root).some((name) => name.startsWith(`${featureId}-`));
}

export function reserveFeatureId(workspace, { featureId, featureSlug }) {
  assertIdentity(featureId, 'feature id');
  assertIdentity(featureSlug, 'feature slug');
  if (featureExistsInDocs(workspace, featureId) || featureExistsInWorktrees(workspace, featureId)) {
    throw new Error(`[cc-nexs] feature id is already in use: ${featureId}`);
  }
  const file = reservationPath(workspace, featureId);
  mkdirSync(join(workspace.projectRoot, '.cc-nexs', 'reservations'), { recursive: true });
  let fd;
  try {
    fd = openSync(file, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify({ feature_id: featureId, feature_slug: featureSlug, reserved_at: new Date().toISOString() }, null, 2)}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const existing = JSON.parse(readFileSync(file, 'utf8'));
      throw new Error(`[cc-nexs] feature id ${featureId} is reserved for ${existing.feature_slug || 'another feature'}`);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return file;
}

export function recordPublishedFeatureReservation(workspace, { featureId, featureSlug, commit, baseBranch }) {
  assertIdentity(featureId, 'feature id');
  assertIdentity(featureSlug, 'feature slug');
  const file = reservationPath(workspace, featureId);
  mkdirSync(join(workspace.projectRoot, '.cc-nexs', 'reservations'), { recursive: true });
  const value = {
    feature_id: featureId,
    feature_slug: featureSlug,
    remote_commit: commit,
    base_branch: baseBranch,
    reserved_at: new Date().toISOString(),
  };
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, 'utf8'));
    if (existing.feature_slug !== featureSlug) {
      throw new Error(`[cc-nexs] feature id ${featureId} is locally reserved for ${existing.feature_slug || 'another feature'}`);
    }
  }
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export function releaseFeatureReservation(workspace, featureId) {
  const file = reservationPath(workspace, assertIdentity(featureId, 'feature id'));
  if (existsSync(file)) unlinkSync(file);
}

export function nextFeatureId(workspace) {
  const ids = new Set();
  const docs = workspace.repositories.find((repo) => repo.id === workspace.docs_repository);
  const docsRoot = docs && join(docs.absolute_path, 'doc');
  if (docsRoot && existsSync(docsRoot)) {
    for (const name of readdirSync(docsRoot)) if (/^\d+\./.test(name)) ids.add(Number(name.match(/^\d+/)[0]));
  }
  if (existsSync(workspace.worktree_root)) {
    for (const name of readdirSync(workspace.worktree_root)) if (/^\d+-/.test(name)) ids.add(Number(name.match(/^\d+/)[0]));
  }
  const reservations = join(workspace.projectRoot, '.cc-nexs', 'reservations');
  if (existsSync(reservations)) {
    for (const name of readdirSync(reservations)) if (/^\d+\.json$/.test(name)) ids.add(Number(name.slice(0, -5)));
  }
  return String((ids.size ? Math.max(...ids) : 0) + 1);
}
