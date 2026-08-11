import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { approveDeployGate, approveHumanGate, transitionState } from './progress-io.mjs';
import { approveProgressGate, readProgressV2, recoverApprovedImplementationSprint } from './progress-v2.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { assertPlanApprovalCurrent, planApprovalBinding } from './plan-contract.mjs';
import { syncHotfixChangeStatuses, syncPlanChangeStatuses } from './release-change-docs.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { assertImplementationApprovalCurrent, implementationApprovalBinding } from './implementation-plan.mjs';

const GATES = new Set(['g1', 'g2', 'plan', 'release']);
const SKIP_DIRS = new Set([
  '.git', '.next', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor',
]);

export function approveFeatureGate({
  cwd = process.cwd(),
  featureId,
  gate,
  sprint = null,
  approver = null,
  progressPath = null,
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
          progressFile, progress: upgraded, gate, sprint: null,
          approval: upgraded.gates.plan, alreadyApproved: false,
        });
      }
      return approvalResult({ progressFile, progress: before, gate, sprint: null, approval: existing, alreadyApproved: true });
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
    if (!['lean', 'hotfix'].includes(before.mode)) throw new Error(`release gate requires lean or hotfix mode, found ${before.mode}`);
    const pendingState = before.mode === 'hotfix' ? 'HOTFIX_RELEASE_PENDING_HUMAN' : 'RELEASE_PENDING_HUMAN';
    if (before.state !== pendingState) {
      const existing = before.gates.release;
      if (existing?.approved) {
        return approvalResult({ progressFile, progress: before, gate, sprint: null, approval: existing, alreadyApproved: true });
      }
      throw new Error(`release gate requires ${pendingState}, found ${before.state}`);
    }
    if (before.mode === 'lean') assertPlanApprovalCurrent(before, dirname(progressFile));
    else assertHotfixScopeCurrent(before, dirname(progressFile));
    const attempt = before.delivery?.test?.attempts?.at(-1);
    if (!attempt || attempt.status !== 'verified' || attempt.verification?.result !== 'passed') {
      throw new Error('[cc-nexs] release approval requires a verified test release attempt');
    }
    const baseTargets = assertReleaseCandidateRefsCurrent({ progress: before, progressFile, attempt });
    if (before.mode === 'hotfix' && before.hotfix?.severity === 'P3') {
      const localAttempt = before.local_verification?.attempts?.findLast((item) => item.status === 'passed' && item.fingerprint === attempt.fingerprint);
      if (!localAttempt?.evidence?.some((item) => item?.type === 'p3_boundary' && item.files === 1 && item.lines <= 20)) {
        throw new Error('[cc-nexs] P3 release approval requires deterministic one-file/20-line boundary evidence');
      }
    } else if (before.review?.status !== 'passed' || before.review.candidate_fingerprint !== attempt.fingerprint) {
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
    };
    const approved = approveProgressGate(progressFile, { gate: 'release', approver: actor, binding });
    if (before.mode === 'hotfix') syncHotfixChangeStatuses(join(dirname(progressFile), 'hotfix.md'), approved.change_requests?.items);
    else syncPlanChangeStatuses(join(dirname(progressFile), 'plan.md'), approved.change_requests?.items);
  } else if (gate === 'g1') {
    const existing = before.gates.g1;
    if (existing?.approved && before.state !== 'SPEC_PENDING_HUMAN') {
      return approvalResult({ progressFile, progress: before, gate, sprint: null, approval: existing, alreadyApproved: true });
    }
    if (before.state !== 'SPEC_PENDING_HUMAN') {
      throw new Error(`G1 requires SPEC_PENDING_HUMAN, found ${before.state}`);
    }
    const specFile = join(dirname(progressFile), 'spec.md');
    if (!existsSync(specFile)) throw new Error('[cc-nexs] G1 requires spec.md');
    const specText = readFileSync(specFile, 'utf8');
    const repositories = resolveAssignedCodeRepositories({ progressFile, progress: before });
    if (!existing?.approved) {
      const binding = g1BindingWithSprintFallback(
        implementationApprovalBinding(specText, { repositories, mode: before.mode }),
        before,
      );
      approveHumanGate(markdownFile, { approver: actor, binding });
    } else {
      assertImplementationApprovalCurrent(before, specText, {
        repositories, mode: before.mode, validateProgressSprint: false,
      });
      if (!Number.isInteger(existing.binding?.sprint_total) || existing.binding.sprint_total < 1) {
        const upgradedBinding = g1BindingWithSprintFallback(
          implementationApprovalBinding(specText, { repositories, mode: before.mode }),
          before,
        );
        approveProgressGate(progressFile, {
          gate: 'g1', approver: existing.approver || actor, binding: upgradedBinding,
        });
      } else {
        recoverApprovedImplementationSprint(progressFile, { actor });
      }
      assertImplementationApprovalCurrent(readProgressV2(progressFile), specText, {
        repositories, mode: before.mode,
      });
    }
    transitionState(markdownFile, {
      from: 'SPEC_PENDING_HUMAN',
      to: 'SPEC_APPROVED',
      reason: 'human approved',
    });
  } else {
    const stateSprint = parseDeployGateSprint(before.state);
    if (before.state !== 'DEPLOY_GATE' && before.state !== 'TEST_RELEASE' && stateSprint === null) {
      const requestedSprint = normalizeSprint(sprint);
      const existing = requestedSprint === null
        ? before.gates.g2
        : before.gates.g2?.sprints?.[String(requestedSprint)];
      if (existing?.approved) {
        return approvalResult({ progressFile, progress: before, gate, sprint: requestedSprint, approval: existing, alreadyApproved: true });
      }
      throw new Error(`G2 requires TEST_RELEASE, DEPLOY_GATE, or SPRINT_<N>_DEPLOY_GATE, found ${before.state}`);
    }

    let requestedSprint = normalizeSprint(sprint);
    if (stateSprint !== null) {
      if (requestedSprint !== null && requestedSprint !== stateSprint) {
        throw new Error(`sprint mismatch: state is M${stateSprint}, requested M${requestedSprint}`);
      }
      requestedSprint = stateSprint;
    } else {
      // Fast mode and final-only delivery have a single deploy gate. Accept an optional M1 for a uniform CLI surface.
      if (requestedSprint !== null && requestedSprint !== 1) {
        throw new Error(`fast-mode DEPLOY_GATE does not accept sprint M${requestedSprint}`);
      }
      requestedSprint = null;
    }

    const existing = requestedSprint === null
      ? before.gates.g2
      : before.gates.g2?.sprints?.[String(requestedSprint)];
    if (existing?.approved) {
      return approvalResult({ progressFile, progress: before, gate, sprint: requestedSprint, approval: existing, alreadyApproved: true });
    }
    approveDeployGate(markdownFile, { approver: actor, sprint: requestedSprint });
  }

  const after = readProgressV2(progressFile);
  const effectiveSprint = gate === 'g2' ? parseApprovedSprint(after, sprint) : null;
  const approval = gate === 'g1'
    ? after.gates.g1
    : gate === 'plan' ? after.gates.plan
      : gate === 'release' ? after.gates.release
        : effectiveSprint === null ? after.gates.g2 : after.gates.g2.sprints[String(effectiveSprint)];
  return approvalResult({ progressFile, progress: after, gate, sprint: effectiveSprint, approval, alreadyApproved: false });
}

function g1BindingWithSprintFallback(binding, progress) {
  if (binding.contract_version === 1) return binding;
  const explicitHistoricalTotal = Number.isInteger(progress.sprint?.total) && progress.sprint.total > 0
    ? progress.sprint.total
    : 1;
  const total = progress.mode === 'full' ? explicitHistoricalTotal : 1;
  return {
    ...binding,
    sprint_contract_version: 0,
    sprints: Array.from({ length: total }, (_, index) => `M${index + 1}`),
    sprint_total: total,
  };
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
    return explicit;
  }

  const direct = findProgressInAncestors(cwd, featureId);
  if (direct) return direct;

  const roots = discoverWorkspaceRoots(resolve(cwd));
  const candidates = [];
  for (const root of roots) {
    for (const [searchRoot, depth] of [
      [join(root, 'doc'), 2],
      [join(root, 'all-docs', 'doc'), 2],
      [join(root, '.worktrees'), 5],
    ]) {
      findProgressCandidates(searchRoot, featureId, depth, candidates);
    }
  }

  const unique = dedupePaths(candidates);
  if (unique.length === 1) return unique[0];
  const worktreeMatches = unique.filter((path) => path.includes(`${join('.worktrees', String(featureId))}-`));
  if (worktreeMatches.length === 1) return worktreeMatches[0];
  if (unique.length === 0) throw new Error(`no progress.json found for feature ${featureId} from ${cwd}`);
  throw new Error(`multiple progress.json files found for feature ${featureId}; pass --progress explicitly:\n${unique.map((path) => `- ${path}`).join('\n')}`);
}

export function normalizeSprint(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^M?(\d+)$/i);
  if (!match || Number(match[1]) < 1) throw new Error(`invalid sprint: ${value}`);
  return Number(match[1]);
}

function approvalResult({ progressFile, progress, gate, sprint, approval, alreadyApproved }) {
  return {
    feature: progress.feature,
    mode: progress.mode,
    state: progress.state,
    gate,
    sprint,
    approver: approval.approver,
    approvedAt: approval.approved_at,
    alreadyApproved,
    progressFile,
  };
}

function parseDeployGateSprint(state) {
  const match = String(state).match(/^SPRINT_(\d+)_DEPLOY_GATE$/);
  return match ? Number(match[1]) : null;
}

function parseApprovedSprint(progress, requested) {
  const stateSprint = parseDeployGateSprint(progress.state);
  if (stateSprint !== null) return stateSprint;
  const normalized = normalizeSprint(requested);
  return normalized === 1 && progress.mode !== 'full' ? null : normalized;
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
    if (existsSync(join(current, '.cc-nexs', 'workspace.yml'))) roots.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  findWorkspaceRoots(cwd, 0, 2, roots);
  return [...roots];
}

function findWorkspaceRoots(root, depth, maxDepth, roots) {
  if (depth > maxDepth || !isDirectory(root)) return;
  if (existsSync(join(root, '.cc-nexs', 'workspace.yml'))) roots.add(root);
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
