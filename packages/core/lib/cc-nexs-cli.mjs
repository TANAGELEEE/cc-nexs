#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { approveFeatureGate, resolveAssignedCodeRepositories, resolveFeatureProgress } from './approval-command.mjs';
import { runBaseRelease } from './base-release.mjs';
import { assertHotfixCandidate, startHotfix } from './hotfix-control.mjs';
import { runLocalVerification } from './local-verify.mjs';
import { recordLeanReview } from './review-control.mjs';
import { requestReleaseChanges } from './release-change-command.mjs';
import { renderLeanPlan } from './plan-render.mjs';
import { runTestRelease } from './test-release.mjs';
import { recordEnvironmentVerification } from './test-verification-control.mjs';
import { migrateFeatureConfig } from './feature-config.mjs';
import { beginImplementationDelta, endImplementationDelta } from './implementation-delta.mjs';
import { assertImplementationApprovalCurrent, parseImplementationOwnership } from './implementation-plan.mjs';
import { syncImplementationWorktrees } from './implementation-worktrees.mjs';
import { readProgressV2 } from './progress-v2.mjs';

export function runCcNexsCommand(argv, { cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  if (command === 'release-test') {
    return runTestRelease({ cwd, ...parseReleaseOptions(args) });
  }
  if (command === 'release-base') {
    return runBaseRelease({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'verify-local') {
    return runLocalVerification({ cwd, ...parseLocalVerificationOptions(args) });
  }
  if (command === 'record-review') {
    return recordLeanReview({ cwd, ...parseReviewOptions(args) });
  }
  if (command === 'start-hotfix') {
    return startHotfix({ cwd, ...parseStartHotfixOptions(args) });
  }
  if (command === 'assert-hotfix-candidate') {
    return assertHotfixCandidate({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'record-test-verification') {
    return recordEnvironmentVerification({ cwd, ...parseTestVerificationOptions(args) });
  }
  if (command === 'render-plan') {
    return renderLeanPlan({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'request-release-changes') {
    return requestReleaseChanges({ cwd, ...parseReleaseChangeOptions(args) });
  }
  if (command === 'migrate-feature-config') {
    return migrateFeatureConfig({ cwd, ...parseFeatureMigrationOptions(args) });
  }
  if (command === 'sync-implementation-worktrees') {
    return syncImplementationWorktrees({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'implementation-delta') {
    const options = parseImplementationDeltaOptions(args);
    return options.operation === 'begin'
      ? beginImplementationDelta({ cwd, ...options })
      : endImplementationDelta({ cwd, ...options });
  }
  if (command === 'validate-implementation-plan') {
    const options = parseFeatureOptions(args);
    const progressFile = resolveFeatureProgress({ cwd, ...options });
    const progress = readProgressV2(progressFile);
    const specText = readFileSync(join(dirname(progressFile), 'spec.md'), 'utf8');
    const repositories = resolveAssignedCodeRepositories({ progressFile, progress });
    const parsed = progress.gates?.g1?.approved
      ? assertImplementationApprovalCurrent(progress, specText, { repositories, mode: progress.mode })
      : parseImplementationOwnership(specText, { repositories, mode: progress.mode });
    const legacySprintTotal = progress.mode === 'full'
      && Number.isInteger(progress.gates?.g1?.binding?.sprint_total || progress.sprint?.total)
      && (progress.gates?.g1?.binding?.sprint_total || progress.sprint?.total) > 0
      ? (progress.gates?.g1?.binding?.sprint_total || progress.sprint.total)
      : 1;
    const effectiveSprints = parsed.contractVersion === 0
      ? Array.from({ length: legacySprintTotal }, (_, index) => `M${index + 1}`)
      : parsed.sprints;
    return {
      kind: 'implementation-plan', progressFile,
      contractVersion: parsed.contractVersion,
      legacy: parsed.legacy === true,
      sprints: effectiveSprints,
      sprintTotal: parsed.contractVersion === 0 ? legacySprintTotal : parsed.sprintTotal,
      assignments: parsed.assignments,
    };
  }
  const gate = command === 'approve-spec'
    ? 'g1'
    : command === 'approve-deploy' ? 'g2'
      : command === 'approve-plan' ? 'plan'
        : command === 'approve-release' ? 'release' : null;
  if (!gate) throw new Error(`unsupported command: ${command || '(missing)'}`);

  const options = parseApprovalOptions(args);
  return approveFeatureGate({ cwd, gate, ...options });
}

function parseStartHotfixOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, severity: null, relatedFeature: null };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--level') options.severity = requireValue(args, ++index, token);
    else if (token.startsWith('--level=')) options.severity = token.slice('--level='.length);
    else if (token === '--related') options.relatedFeature = requireValue(args, ++index, token);
    else if (token.startsWith('--related=')) options.relatedFeature = token.slice('--related='.length);
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseTestVerificationOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, status: null, attemptId: null, evidence: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--passed') options.status = options.status ? 'invalid' : 'passed';
    else if (token === '--blocked') options.status = options.status ? 'invalid' : 'blocked';
    else if (token === '--manual-required') options.status = options.status ? 'invalid' : 'manual_required';
    else if (token === '--attempt') options.attemptId = requireValue(args, ++index, token);
    else if (token.startsWith('--attempt=')) options.attemptId = token.slice('--attempt='.length);
    else if (token === '--evidence') options.evidence.push(requireValue(args, ++index, token));
    else if (token.startsWith('--evidence=')) options.evidence.push(token.slice('--evidence='.length));
    else if (token === '--evidence-json') options.evidence.push(parseEvidenceJson(requireValue(args, ++index, token)));
    else if (token.startsWith('--evidence-json=')) options.evidence.push(parseEvidenceJson(token.slice('--evidence-json='.length)));
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (!['passed', 'blocked', 'manual_required'].includes(options.status)) {
    throw new Error('record-test-verification requires exactly one of --passed, --blocked, or --manual-required');
  }
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseLocalVerificationOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, recordStatus: null, evidence: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--passed') options.recordStatus = options.recordStatus ? 'invalid' : 'passed';
    else if (token === '--failed') options.recordStatus = options.recordStatus ? 'invalid' : 'failed';
    else if (token === '--deferred-to-test') options.recordStatus = options.recordStatus ? 'invalid' : 'deferred_to_test';
    else if (token === '--evidence-json') options.evidence.push(parseEvidenceJson(requireValue(args, ++index, token)));
    else if (token.startsWith('--evidence-json=')) options.evidence.push(parseEvidenceJson(token.slice('--evidence-json='.length)));
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (options.recordStatus === 'invalid') {
    throw new Error('verify-local accepts only one of --passed, --failed, or --deferred-to-test');
  }
  if (options.evidence.length > 0 && !options.recordStatus) {
    throw new Error('verify-local --evidence-json requires --passed, --failed, or --deferred-to-test');
  }
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseEvidenceJson(value) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new Error('--evidence-json must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--evidence-json must be a JSON object');
  }
  return parsed;
}

function parseFeatureOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseImplementationDeltaOptions(args) {
  const positional = [];
  const options = {
    operation: null,
    featureId: null,
    progressPath: null,
    assignmentIds: [],
    allowedDocPaths: [],
    token: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--assignment') options.assignmentIds.push(requireValue(args, ++index, value));
    else if (value.startsWith('--assignment=')) options.assignmentIds.push(value.slice('--assignment='.length));
    else if (value === '--allow-doc-path') options.allowedDocPaths.push(requireValue(args, ++index, value));
    else if (value.startsWith('--allow-doc-path=')) options.allowedDocPaths.push(value.slice('--allow-doc-path='.length));
    else if (value === '--token') options.token = requireValue(args, ++index, value);
    else if (value.startsWith('--token=')) options.token = value.slice('--token='.length);
    else if (value === '--progress') options.progressPath = requireValue(args, ++index, value);
    else if (value.startsWith('--progress=')) options.progressPath = value.slice('--progress='.length);
    else if (value.startsWith('-')) throw new Error(`unknown option: ${value}`);
    else positional.push(value);
  }
  options.operation = positional[0] || null;
  options.featureId = positional[1] || null;
  if (!['begin', 'end'].includes(options.operation)) {
    throw new Error('implementation-delta requires begin or end');
  }
  if (!options.featureId) throw new Error('implementation-delta requires a feature id');
  if (positional.length > 2) throw new Error(`unexpected arguments: ${positional.slice(2).join(' ')}`);
  if (options.operation === 'begin') {
    if (options.assignmentIds.length === 0) throw new Error('implementation-delta begin requires --assignment');
    if (options.token) throw new Error('implementation-delta begin does not accept --token');
  } else {
    if (!options.token) throw new Error('implementation-delta end requires --token');
    if (options.assignmentIds.length > 0) throw new Error('implementation-delta end does not accept --assignment');
    if (options.allowedDocPaths.length > 0) throw new Error('implementation-delta end does not accept --allow-doc-path');
  }
  return options;
}

function parseFeatureMigrationOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, dryRun: false, bindPlanRisk: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--bind-plan-risk') options.bindPlanRisk = true;
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseReviewOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, closure: false, gatewayBDelta: false, blockingFindings: [] };
  let passed = false;
  let blocked = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--passed') passed = true;
    else if (token === '--blocked') blocked = true;
    else if (token === '--closure') options.closure = true;
    else if (token === '--gateway-b-delta') options.gatewayBDelta = true;
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token === '--finding') options.blockingFindings.push(requireValue(args, ++index, token));
    else if (token.startsWith('--finding=')) options.blockingFindings.push(token.slice('--finding='.length));
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  if (passed === blocked) throw new Error('record-review requires exactly one of --passed or --blocked');
  if (options.closure && options.gatewayBDelta) throw new Error('record-review accepts only one delta review type');
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  if (passed && options.blockingFindings.length > 0) throw new Error('a passing Review cannot contain blocking findings');
  return { ...options, status: passed ? 'passed' : 'blocked' };
}

function parseReleaseChangeOptions(args) {
  const positional = [];
  const options = {
    featureId: null,
    progressPath: null,
    kind: null,
    feedback: null,
    affectedAcs: [],
    paths: [],
    actor: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--type') options.kind = requireValue(args, ++index, token);
    else if (token.startsWith('--type=')) options.kind = token.slice('--type='.length);
    else if (token === '--feedback') options.feedback = requireValue(args, ++index, token);
    else if (token.startsWith('--feedback=')) options.feedback = token.slice('--feedback='.length);
    else if (token === '--ac') options.affectedAcs.push(requireValue(args, ++index, token));
    else if (token.startsWith('--ac=')) options.affectedAcs.push(token.slice('--ac='.length));
    else if (token === '--path') options.paths.push(requireValue(args, ++index, token));
    else if (token.startsWith('--path=')) options.paths.push(token.slice('--path='.length));
    else if (token === '--actor') options.actor = requireValue(args, ++index, token);
    else if (token.startsWith('--actor=')) options.actor = token.slice('--actor='.length);
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

function parseReleaseOptions(args) {
  const positional = [];
  const options = { featureId: null, progressPath: null, retry: false, resume: false, dryRun: false, hotfix: false, capabilityAttested: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token === '--retry') options.retry = true;
    else if (token === '--resume') options.resume = true;
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--hotfix') options.hotfix = true;
    else if (token === '--capability-attested') options.capabilityAttested = true;
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (options.resume && options.retry) throw new Error('--resume and --retry are mutually exclusive');
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
}

export function splitCommandArguments(text = '') {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\"/g, '"'));
  return tokens;
}

function parseApprovalOptions(args) {
  const positional = [];
  const options = { featureId: null, sprint: null, approver: null, progressPath: null };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--approver') options.approver = requireValue(args, ++index, token);
    else if (token.startsWith('--approver=')) options.approver = token.slice('--approver='.length);
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token === '--sprint') options.sprint = requireValue(args, ++index, token);
    else if (token.startsWith('--sprint=')) options.sprint = token.slice('--sprint='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional[1] && options.sprint === null) options.sprint = positional[1];
  if (positional.length > 2) throw new Error(`unexpected arguments: ${positional.slice(2).join(' ')}`);
  return options;
}

function requireValue(args, index, option) {
  if (!args[index]) throw new Error(`${option} requires a value`);
  return args[index];
}

function printResult(result) {
  if (result.kind === 'implementation-delta-begin') {
    console.log(`cc-nexs implementation delta baseline ready (${result.sprint} wave ${result.wave})`);
    console.log(`Assignments: ${result.assignments.join(', ')}`);
    console.log(`Token: ${result.token}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'implementation-delta-end') {
    console.log(`cc-nexs implementation delta valid (${result.sprint} wave ${result.wave})`);
    console.log(`Assignments: ${result.assignments.join(', ')}`);
    for (const [repository, paths] of Object.entries(result.changed)) {
      console.log(`${repository}: ${paths.length > 0 ? paths.join(', ') : '(no changes)'}`);
    }
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'implementation-worktree-sync') {
    console.log(`cc-nexs implementation worktrees ${result.changed ? 'synced' : 'already current'}`);
    console.log(`Repositories: ${result.repositories.join(', ') || '(legacy single worker)'}`);
    if (result.created.length > 0) console.log(`Created: ${result.created.join(', ')}`);
    if (result.recovered.length > 0) console.log(`Recovered: ${result.recovered.join(', ')}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'implementation-plan') {
    console.log(`cc-nexs implementation plan valid (contract v${result.contractVersion})`);
    console.log(`Assignments: ${result.assignments.length}`);
    console.log(`Sprints: ${result.sprints.join(', ')} (total ${result.sprintTotal})`);
    console.log(`Legacy single worker: ${result.legacy ? 'yes' : 'no'}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'feature-config-migration') {
    console.log(`cc-nexs feature config ${result.changed ? (result.dryRun ? 'needs migration' : 'migrated') : 'is current'}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Legacy roles removed: ${result.removedLegacyRoles}`);
    console.log(`risk_tier added: ${result.addedRiskTier}`);
    console.log(`config_version upgraded: ${result.upgradedConfigVersion}`);
    console.log(`Gateway A risk binding: ${result.planRiskBindingStatus}${result.planRiskTier ? ` (${result.planRiskTier})` : ''}`);
    console.log(`Gateway A risk backfilled: ${result.planRiskBindingChanged}`);
    console.log(`Config: ${result.configFile}`);
    return;
  }
  if (result.kind === 'plan-render') {
    console.log(`cc-nexs plan rendered: ${result.output}`);
    return;
  }
  if (result.kind === 'local-verification') {
    console.log(`cc-nexs local verification ${result.status}${result.reused ? ' (reused)' : ''}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'hotfix-start') {
    console.log(`cc-nexs hotfix ${result.hotfix.severity} scope bound`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'hotfix-candidate-boundary') {
    console.log(`cc-nexs P3 candidate boundary ${result.status}`);
    if (result.reason) console.log(`Reason: ${result.reason}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'test-verification') {
    console.log(`cc-nexs test verification ${result.status}`);
    console.log(`Attempt: ${result.attempt}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'release-change-request') {
    console.log(`cc-nexs Gateway B change ${result.request.id} recorded`);
    console.log(`Type: ${result.request.kind}`);
    console.log(`State: ${result.state}`);
    console.log(`Plan: ${result.planHtml}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'base-release') {
    console.log(`cc-nexs base release ${result.status}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Attempt: ${result.attempt?.id || 'unknown'}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.review) {
    console.log(`cc-nexs lean review ${result.review.status}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    return;
  }
  if (result.kind === 'test-release') {
    const status = result.dryRun ? 'preflight passed' : result.attempt?.status || 'unknown';
    console.log(`cc-nexs test release ${status}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Environment: ${result.environment}`);
    for (const repo of result.repositories) {
      console.log(`Repository: ${repo.id} ${repo.sourceCommit} -> ${repo.delivery === 'local' ? `local:${repo.worktree}` : repo.targetBranch}`);
    }
    if (result.attempt) console.log(`Attempt: ${result.attempt.id}`);
    if (result.attempt?.status === 'deploying') console.log('CI/CD: deploying; resume this exact attempt with release-test --resume');
    if (result.verificationPrerequisites?.ready === false) {
      console.log(`Post-deploy verification prerequisites pending: ${result.verificationPrerequisites.missing.join(', ')}`);
    }
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  const gate = result.gate.toUpperCase();
  const sprint = result.sprint === null ? '' : ` M${result.sprint}`;
  const status = result.alreadyApproved ? 'already approved' : 'approved';
  console.log(`cc-nexs ${gate}${sprint} ${status}`);
  console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
  console.log(`State: ${result.state}`);
  console.log(`Approver: ${result.approver}`);
  console.log(`Approved at: ${result.approvedAt}`);
  console.log(`Progress: ${result.progressFile}`);
}

function printUsage() {
  console.error('Usage:');
  console.error('  cc-nexs approve-spec <feature-id> [--approver <name>] [--progress <path>]');
  console.error('  cc-nexs approve-deploy <feature-id> [M<N>] [--approver <name>] [--progress <path>]');
  console.error('  cc-nexs approve-plan <feature-id> [--approver <name>] [--progress <path>]');
  console.error('  cc-nexs approve-release <feature-id> [--approver <name>] [--progress <path>]');
  console.error('  cc-nexs release-test <feature-id> [--resume | --retry] [--dry-run] [--hotfix] [--progress <path>]');
  console.error('  cc-nexs verify-local <feature-id> [--passed|--failed|--deferred-to-test --evidence-json <json>] [--progress <path>]');
  console.error('  cc-nexs record-review <feature-id> <--passed|--blocked> [--finding <P0/P1 text>] [--closure|--gateway-b-delta] [--progress <path>]');
  console.error('  cc-nexs start-hotfix <feature-id> [--level <P0|P1|P2|P3>] [--related <feature-id>] [--progress <path>]');
  console.error('  cc-nexs assert-hotfix-candidate <feature-id> [--progress <path>]');
  console.error('  cc-nexs record-test-verification <feature-id> <--passed|--blocked|--manual-required> --evidence <text> [--attempt <id>] [--progress <path>]');
  console.error('  cc-nexs request-release-changes <feature-id> --type <evidence|implementation|scope> --feedback <text> [--ac <id>] [--path <path>] [--progress <path>]');
  console.error('  cc-nexs release-base <feature-id> [--progress <path>]');
  console.error('  cc-nexs render-plan <feature-id> [--progress <path>]');
  console.error('  cc-nexs migrate-feature-config <feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]');
  console.error('  cc-nexs sync-implementation-worktrees <feature-id> [--progress <path>]');
  console.error('  cc-nexs implementation-delta begin <feature-id> --assignment <IMP-id> [--assignment <IMP-id> ...] [--allow-doc-path <test-cases.md|qa-scripts/**>] [--progress <path>]');
  console.error('  cc-nexs implementation-delta end <feature-id> --token <token> [--progress <path>]');
  console.error('  cc-nexs validate-implementation-plan <feature-id> [--progress <path>]');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    printResult(runCcNexsCommand(process.argv.slice(2)));
  } catch (error) {
    printUsage();
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
