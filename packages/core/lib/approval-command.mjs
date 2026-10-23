import { releaseScope } from './release-scope.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { transitionState } from './progress-io.mjs';
import { approveProgressGate, assertTestAttemptNotInvalidated, readProgressV2 } from './progress-v2.mjs';
import { assertHotfixScopeCurrent, extractHotfixScope, resolveHotfixDocument } from './hotfix-contract.mjs';
import { assertPlanApprovalCurrent, assertRequirementTraceability, extractApprovalScope, planApprovalBinding } from './plan-contract.mjs';
import { assertRecordedLocalVerification, extractLocalVerificationChecks } from './local-evidence.mjs';
import { syncHotfixChangeStatuses, syncPlanChangeStatuses } from './release-change-docs.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { createReleaseExceptionBinding } from './release-exception.mjs';

const GATES = new Set(['plan', 'release']);
const SKIP_DIRS = new Set([
  '.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor',
]);

export function approveFeatureGate({
  cwd = process.cwd(),
  featureId,
  gate,
  approver = null,
  progressPath = null,
  testException = null,
} = {}) {
  if (!featureId) throw new Error('feature id is required');
  if (!GATES.has(gate)) throw new Error(`unsupported gate: ${gate || '(missing)'}`);

  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const markdownFile = join(dirname(progressFile), 'progress.md');
  if (!existsSync(markdownFile)) throw new Error(`progress.md is missing beside ${progressFile}`);

  const before = readProgressV2(progressFile);
  if (!sameFeatureId(before.feature.id, featureId)) {
    throw new Error(`feature mismatch: requested ${featureId}, found ${before.feature.id}`);
  }

  const actor = approver || resolveGitApprover(dirname(progressFile));
  if (gate === 'plan') {
    if (before.mode !== 'lean') throw new Error(`plan gate requires lean mode, found ${before.mode}`);
    const existing = before.gates.plan;
    if (existing?.approved && before.state !== 'PLAN_PENDING_HUMAN') {
      if (existing.binding?.delivery_contract_version === 1) {
        if ((before.delivery?.test?.attempts?.length || 0) > 0) {
          throw new Error('[cc-nexs] cannot bind a legacy Gateway A test target after test delivery has started');
        }
        const upgradedBinding = planApprovalBinding(dirname(progressFile), {
          requireRiskTier: true,
          requireDeliveryLane: true,
        });
        upgradedBinding.test_targets = assertLeanTestDeliveryContract({
          binding: upgradedBinding, progress: before, progressFile,
        });
        upgradedBinding.delivery_contract_version = 2;
        const upgraded = approveProgressGate(progressFile, { gate: 'plan', approver: actor, binding: upgradedBinding });
        return approvalResult({
          progressFile, progress: upgraded, gate,
          approval: upgraded.gates.plan, alreadyApproved: false,
        });
      }
      return approvalResult({ progressFile, progress: before, gate, approval: existing, alreadyApproved: true });
    }
    if (before.state !== 'PLAN_PENDING_HUMAN') {
      throw new Error(`plan gate requires PLAN_PENDING_HUMAN, found ${before.state}`);
    }
    const binding = planApprovalBinding(dirname(progressFile), {
      requireRiskTier: true,
      requireDeliveryLane: true,
    });
    binding.test_targets = assertLeanTestDeliveryContract({ binding, progress: before, progressFile });
    binding.delivery_contract_version = 2;
    assertRequirementTraceability(dirname(progressFile));
    if (!existing?.approved
      || existing?.binding?.combined_sha256 !== binding.combined_sha256
      || existing?.binding?.delivery_contract_version !== binding.delivery_contract_version
      || JSON.stringify(existing?.binding?.test_targets || {}) !== JSON.stringify(binding.test_targets)) {
      approveProgressGate(progressFile, { gate: 'plan', approver: actor, binding });
    }
    transitionState(markdownFile, {
      from: 'PLAN_PENDING_HUMAN',
      to: 'PLAN_APPROVED',
      reason: 'human approved lean plan',
    });
  } else if (gate === 'release') {
    const pendingState = before.mode === 'hotfix' ? 'HOTFIX_RELEASE_PENDING_HUMAN' : 'RELEASE_PENDING_HUMAN';
    const manualState = before.mode === 'hotfix' ? 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY' : 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY';
    const recoverableTestState = ['lean', 'hotfix'].includes(before.mode) && ['TEST_RELEASE', 'TEST_VERIFYING', 'TEST_VERIFIED', 'HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_VERIFYING'].includes(before.state);
    if (!recoverableTestState && before.state !== pendingState && !(testException && before.state === manualState)) {
      const existing = before.gates.release;
      if (existing?.approved) {
        assertTestAttemptNotInvalidated(before.delivery?.test?.attempts?.find((item) => item.id === existing.binding?.test_attempt));
        const localChecks = extractLocalVerificationChecks(releaseScope(before, progressFile));
        assertRecordedLocalVerification(before, { source: existing.binding?.source, fingerprint: existing.binding?.candidate_fingerprint, expectedChecks: localChecks });
        return approvalResult({ progressFile, progress: before, gate, approval: existing, alreadyApproved: true });
      }
      throw new Error(`release gate requires ${pendingState}, found ${before.state}`);
    }
    const localChecks = extractLocalVerificationChecks(releaseScope(before, progressFile));
    const attempt = before.delivery?.test?.attempts?.at(-1);
    assertTestAttemptNotInvalidated(attempt);
    const exceptionBinding = testException ? createReleaseExceptionBinding(before, testException) : null;
    if (!exceptionBinding && (!attempt || attempt.status !== 'verified' || attempt.verification?.result !== 'passed')) {
      throw new Error('[cc-nexs] release approval requires a verified test release attempt');
    }
    const baseTargets = assertReleaseCandidateRefsCurrent({ progress: before, progressFile, attempt });
    assertRecordedLocalVerification(before, { source: attempt.source, fingerprint: attempt.fingerprint, expectedChecks: localChecks });
    if (before.review?.status !== 'passed' || before.review.candidate_fingerprint !== attempt.fingerprint) {
      throw new Error('[cc-nexs] release approval requires a consolidated review for the tested candidate');
    }
    const binding = {
      candidate_fingerprint: attempt.fingerprint,
      source: attempt.source,
      base_targets: baseTargets,
      test_attempt: attempt.id,
      environment_revision: attempt.environment_revision,
      plan_binding: before.mode === 'lean' ? before.gates.plan?.binding?.combined_sha256 || null : null,
      hotfix_scope_binding: before.mode === 'hotfix' ? before.hotfix.scope_binding.hotfix_scope_sha256 : null,
      ...(exceptionBinding && { test_exception: exceptionBinding }),
    };
    const approved = approveProgressGate(progressFile, { gate: 'release', approver: actor, binding, expectedRevision: before.revision });
    if (before.mode === 'hotfix') syncHotfixChangeStatuses(resolveHotfixDocument(before, dirname(progressFile)), approved.change_requests?.items);
    else if (before.mode === 'lean') syncPlanChangeStatuses(join(dirname(progressFile), 'plan.md'), approved.change_requests?.items);
    if (recoverableTestState) transitionState(markdownFile, { from: before.state, to: pendingState, reason: 'reconciled exact verified candidate and Review with existing user release authorization' });
    if (exceptionBinding && before.state === manualState) {
      transitionState(markdownFile, { from: manualState, to: pendingState, reason: 'human authorized base release with a bound test-environment exception; test remains unverified' });
    }
  }

  const after = readProgressV2(progressFile);
  return approvalResult({ progressFile, progress: after, gate, approval: after.gates[gate], alreadyApproved: false });
}

function assertLeanTestDeliveryContract({ binding, progress, progressFile }) {
  const workspaceRoot = findWorkspaceConfigRoot(dirname(progressFile));
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });

  const workspaceById = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  const docsRepositories = new Set(workspace.repositories
    .filter((repository) => repository.docs === true || repository.id === workspace.docs_repository)
    .map((repository) => repository.id));
  const assignedCodeRepositories = [];
  for (const repository of Object.keys(progress.repositories || {})) {
    if (!workspaceById.has(repository)) {
      throw new Error(`[cc-nexs] Gateway A found assigned repository missing from workspace config: ${repository}`);
    }
    if (!docsRepositories.has(repository)) assignedCodeRepositories.push(repository);
  }
  assignedCodeRepositories.sort();

  const assigned = new Set(assignedCodeRepositories);
  const declared = Object.keys(binding.test_delivery || {}).sort();
  const unknown = declared.filter((repository) => !assigned.has(repository));
  if (unknown.length > 0) {
    throw new Error(`[cc-nexs] Gateway A plan.md has unknown or unassigned test_delivery repositories: ${unknown.join(', ')}`);
  }
  const missing = assignedCodeRepositories.filter((repository) => !declared.includes(repository));
  if (missing.length > 0) {
    throw new Error(`[cc-nexs] Gateway A plan.md is missing test_delivery coverage for assigned code repositories: ${missing.join(', ')}`);
  }

  const deployRepositories = assignedCodeRepositories
    .filter((repository) => binding.test_delivery[repository] === 'deploy');
  if (deployRepositories.length === 0) {
    throw new Error('[cc-nexs] Gateway A requires at least one assigned code repository with test_delivery.<repo>: deploy');
  }
  for (const repository of deployRepositories) {
    if (!workspaceById.get(repository).test_branch) {
      throw new Error(`[cc-nexs] Gateway A repository ${repository} is marked deploy but has no test_branch in workspace config`);
    }
  }
  return Object.fromEntries(deployRepositories.map((repository) => [
    repository,
    workspaceById.get(repository).test_branch,
  ]));
}

function assertReleaseCandidateRefsCurrent({ progress, progressFile, attempt }) {
  const workspaceRoot = findWorkspaceConfigRoot(dirname(progressFile));
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const workspaceById = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  const baseTargets = {};
  for (const [repository, testedCommit] of Object.entries(attempt.source || {})) {
    const configured = workspaceById.get(repository);
    const assignment = progress.repositories?.[repository];
    const candidateRef = assignment?.candidate?.ref;
    if (!configured || !candidateRef) {
      throw new Error(`[cc-nexs] release approval cannot resolve current candidate ref for ${repository}`);
    }
    if (typeof assignment.base_branch !== 'string' || !assignment.base_branch.trim()) {
      throw new Error(`[cc-nexs] release approval requires an assigned base branch for ${repository}`);
    }
    if (configured.base_branch !== assignment.base_branch) {
      throw new Error(`[cc-nexs] release approval base branch changed since candidate assignment for ${repository}`);
    }
    let currentCommit;
    try {
      currentCommit = execFileSync('git', ['-C', configured.absolute_path, 'rev-parse', candidateRef], { encoding: 'utf8' }).trim();
    } catch (error) {
      throw new Error(`[cc-nexs] release approval cannot resolve candidate ref for ${repository}: ${error.message}`);
    }
    if (currentCommit !== testedCommit) {
      throw new Error(`[cc-nexs] release approval candidate ref moved after test verification for ${repository}`);
    }
    baseTargets[repository] = configured.base_branch;
  }
  return baseTargets;
}

function findWorkspaceConfigRoot(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml'))
      || existsSync(join(current, '.cc-nexs', 'workspace.json'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('[cc-nexs] Gateway A requires .cc-nexs/workspace.yml or workspace.json');
    }
    current = parent;
  }
}

export function resolveAssignedCodeRepositories({ progressFile, progress }) {
  const workspaceRoot = findWorkspaceConfigRoot(dirname(progressFile));
  const workspace = loadWorkspaceConfig({ projectRoot: workspaceRoot });
  const docs = new Set(workspace.repositories
    .filter((repository) => repository.docs === true || repository.id === workspace.docs_repository)
    .map((repository) => repository.id));
  const workspaceIds = new Set(workspace.repositories.map((repository) => repository.id));
  return Object.keys(progress.repositories || {}).filter((repository) => (
    workspaceIds.has(repository) && !docs.has(repository)
  ));
}

export function resolveFeatureProgress({ cwd = process.cwd(), featureId, progressPath = null }) {
  if (progressPath) {
    const explicit = resolve(cwd, progressPath);
    if (!existsSync(explicit)) throw new Error(`progress file not found: ${explicit}`);
    const progress = readProgressV2(explicit);
    if (!sameFeatureId(progress.feature.id, featureId)) throw new Error(`feature mismatch: requested ${featureId}, found ${progress.feature.id}`);
    return explicit;
  }

  const direct = findProgressInAncestors(cwd, featureId);
  if (direct) return direct;

  const roots = discoverWorkspaceRoots(resolve(cwd));
  const candidates = [];
  const worktreeRoots = [];
  for (const root of roots) {
    let workspace = null;
    try { workspace = loadWorkspaceConfig({ projectRoot: root }); } catch { /* Legacy discovery remains available for invalid workspace configs. */ }
    const docsSource = workspace?.repositories.find((repo) => repo.id === workspace.docs_repository)?.absolute_path || join(root, 'all-docs');
    const worktreeRoot = workspace?.worktree_root || join(root, '.worktrees');
    worktreeRoots.push(worktreeRoot);
    for (const [searchRoot, depth] of [
      [join(root, 'doc'), 6],
      [join(root, 'all-docs', 'doc'), 6],
      [join(docsSource, 'doc'), 6],
      [join(docsSource, 'hotfix'), 6],
      [join(root, '.cc-nexs', 'hotfixes'), 2],
      [join(root, 'all-docs', 'hotfix'), 4],
      [join(root, '.worktrees'), 8],
      [worktreeRoot, 8],
    ]) {
      findProgressCandidates(searchRoot, featureId, depth, candidates);
    }
  }

  const unique = dedupePaths(candidates);
  if (unique.length === 1) return unique[0];
  const worktreeMatches = unique.filter((path) => worktreeRoots.some((root) => {
    const rel = relative(root, path);
    return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }));
  if (worktreeMatches.length === 1) return worktreeMatches[0];
  if (unique.length === 0) throw new Error(`no progress.json found for feature ${featureId} from ${cwd}`);
  throw new Error(`multiple progress.json files found for feature ${featureId}; pass --progress explicitly:\n${unique.map((path) => `- ${path}`).join('\n')}`);
}

function approvalResult({ progressFile, progress, gate, approval, alreadyApproved }) {
  return {
    feature: progress.feature,
    mode: progress.mode,
    state: progress.state,
    gate,
    approver: approval.approver,
    approvedAt: approval.approved_at,
    alreadyApproved,
    progressFile,
  };
}

function sameFeatureId(left, right) {
  const a = String(left);
  const b = String(right);
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a === b;
}

function resolveGitApprover(cwd) {
  try {
    const value = execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (value) return value;
  } catch { /* fall through */ }
  return process.env.USER || process.env.USERNAME || 'unknown';
}

function findProgressInAncestors(cwd, featureId) {
  let current = resolve(cwd);
  while (true) {
    const progress = join(current, 'progress.json');
    if (matchesFeature(progress, featureId)) return progress;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function discoverWorkspaceRoots(cwd) {
  const roots = new Set([cwd]);
  let current = cwd;
  while (true) {
    if (['workspace.yml', 'workspace.json'].some((name) => existsSync(join(current, '.cc-nexs', name)))) roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  findWorkspaceRoots(cwd, 0, 2, roots);
  return [...roots];
}

function findWorkspaceRoots(root, depth, maxDepth, roots) {
  if (depth > maxDepth || !isDirectory(root)) return;
  if (['workspace.yml', 'workspace.json'].some((name) => existsSync(join(root, '.cc-nexs', name)))) roots.add(root);
  if (depth === maxDepth) return;
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
    findWorkspaceRoots(join(root, entry.name), depth + 1, maxDepth, roots);
  }
}

function findProgressCandidates(root, featureId, maxDepth, out, depth = 0) {
  if (depth > maxDepth || !isDirectory(root)) return;
  const progress = join(root, 'progress.json');
  if (matchesFeature(progress, featureId)) out.push(progress);
  if (depth === maxDepth) return;
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
    findProgressCandidates(join(root, entry.name), featureId, maxDepth, out, depth + 1);
  }
}

function matchesFeature(progressFile, featureId) {
  if (!existsSync(progressFile)) return false;
  try {
    const progress = JSON.parse(readFileSync(progressFile, 'utf8'));
    return sameFeatureId(progress?.feature?.id, featureId);
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.worktrees');
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function safeReadDir(path) {
  try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}

function dedupePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const path of paths) {
    let key;
    try { key = realpathSync(path); } catch { key = resolve(path); }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}
