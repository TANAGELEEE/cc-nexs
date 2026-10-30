#!/usr/bin/env node

import { resolveTestConflict } from './test-conflict.mjs';
import { syncReleaseBase } from './base-sync.mjs';
import { switchTestTarget } from './test-target.mjs';

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { approveFeatureGate } from './approval-command.mjs';
import { runBaseRelease } from './base-release.mjs';
import { assertHotfixCandidate, startHotfix } from './hotfix-control.mjs';
import { initializeHotfix } from './hotfix-init.mjs';
import { reviseHotfix } from './hotfix-revision.mjs';
import { runLocalVerification } from './local-verify.mjs';
import { recordLeanPlanReview, recordLeanReview } from './review-control.mjs';
import { requestReleaseChanges } from './release-change-command.mjs';
import { renderLeanPlan } from './plan-render.mjs';
import { runTestRelease } from './test-release.mjs';
import { recordEnvironmentVerification } from './test-verification-control.mjs';
import { migrateFeatureConfig } from './feature-config.mjs';
import { modelGateway } from './model-gateway.mjs';
import { formatInventory, reclaimWorktrees } from './worktree-reclaim.mjs';
import { advanceFeatureState, featureStatus } from './workflow-snapshot.mjs';

export function runCcNexsCommand(argv, { cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  if (command === 'switch-test-target') {
    if (args.length !== 2 || args[0] !== '--request') throw new Error('switch-test-target --request <json-file>');
    return switchTestTarget({ ...JSON.parse(readFileSync(args[1], 'utf8')), cwd });
  }
  if (command === 'model-gateway') {
    if (args.length !== 3 || args[1] !== '--request') throw new Error('model-gateway <inspect|prepare|view|start|feedback|result> --request <json-file>');
    return modelGateway(args[0], JSON.parse(readFileSync(args[2], 'utf8')), { cwd });
  }
  if (command === 'reclaim-worktrees') {
    const options = { sizes: false, confirm: null };
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--sizes') options.sizes = true;
      else if (args[index] === '--confirm') options.confirm = requireValue(args, ++index, '--confirm');
      else if (args[index].startsWith('--confirm=')) options.confirm = args[index].slice('--confirm='.length);
      else throw new Error(`unknown option: ${args[index]}`);
    }
    return reclaimWorktrees({ cwd, ...options });
  }
  if (command === 'status') return featureStatus({ cwd, ...parseStatusOptions(args) });
  if (command === 'advance') return advanceFeatureState({ cwd, ...parseAdvanceOptions(args) });
  if (command === 'init-hotfix') return initializeHotfix({ cwd, ...parseHotfixLifecycleOptions(args, true) });
  if (command === 'revise-hotfix') return reviseHotfix({ cwd, ...parseHotfixLifecycleOptions(args, false) });
  if (command === 'release-test') {
    return runTestRelease({ cwd, ...parseReleaseOptions(args) });
  }
  if (command === 'resolve-test-conflict') return resolveTestConflict({ cwd, ...parseFeatureOptions(args) });
  if (command === 'sync-base') return syncReleaseBase({ cwd, ...parseFeatureOptions(args) });
  if (command === 'release-base') {
    return runBaseRelease({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'verify-local') {
    return runLocalVerification({ cwd, ...parseLocalVerificationOptions(args) });
  }
  if (command === 'record-review') {
    return recordLeanReview({ cwd, ...parseReviewOptions(args) });
  }
  if (command === 'record-plan-review') {
    const options = parseReviewOptions(args);
    if (options.closure || options.gatewayBDelta) throw new Error('record-plan-review does not accept delta review flags');
    return recordLeanPlanReview({ cwd, featureId: options.featureId, progressPath: options.progressPath, status: options.status, blockingFindings: options.blockingFindings });
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
  const gate = command === 'approve-plan' ? 'plan'
    : command === 'approve-release' ? 'release' : null;
  if (!gate) throw new Error(`unsupported command: ${command || '(missing)'}`);

  const options = parseApprovalOptions(args);
  if (options.testException && gate !== 'release') throw new Error('--test-exception is only valid for approve-release');
  return approveFeatureGate({ cwd, gate, ...options });
}

function parseHotfixLifecycleOptions(args, initialize) {
  const fields = initialize
    ? { '--description': 'description', '--bug-key': 'bugKey', '--related': 'relatedFeature', '--repos': 'repositoryIds', '--bug-file': 'bugFile' }
    : { '--reason': 'reason', '--authorization-evidence': 'authorizationEvidence', '--progress': 'progressPath' };
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!initialize && token === '--promote-lean') { options.promoteLean = true; continue; }
    const equals = token.indexOf('=');
    const flag = equals < 0 ? token : token.slice(0, equals);
    if (fields[flag]) {
      const value = equals < 0 ? requireValue(args, ++i, flag) : token.slice(equals + 1);
      options[fields[flag]] = flag === '--repos' ? value.split(',').filter(Boolean) : value;
    } else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  if (positional.length !== 1) throw new Error(initialize ? 'init-hotfix requires one slug' : 'revise-hotfix requires one BUG key');
  options[initialize ? 'slug' : 'featureId'] = positional[0];
  return options;
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

function parseStatusOptions(args) {
  const rest = args.filter((token) => token !== '--no-auto-test-release');
  return { ...parseFeatureOptions(rest), noAutoTestRelease: rest.length !== args.length };
}

function parseAdvanceOptions(args) {
  const fields = { '--from': 'from', '--to': 'to', '--reason': 'reason' };
  const options = {};
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const equals = token.indexOf('=');
    const flag = equals < 0 ? token : token.slice(0, equals);
    if (fields[flag]) options[fields[flag]] = equals < 0 ? requireValue(args, ++index, flag) : token.slice(equals + 1);
    else rest.push(token);
  }
  return { ...parseFeatureOptions(rest), ...options };
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
  const options = { featureId: null, approver: null, progressPath: null };
  const exceptionFields = { '--authorization-evidence': 'authorizationEvidence', '--reason': 'reason', '--environment-evidence': 'environmentEvidence', '--rollback-evidence': 'rollbackEvidence' };
  const exception = {};
  let exceptionRequested = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const flag = token.split('=')[0];
    if (token === '--test-exception') exceptionRequested = true;
    else if (exceptionFields[flag]) exception[exceptionFields[flag]] = token.includes('=') ? token.slice(token.indexOf('=') + 1) : requireValue(args, ++index, token);
    else if (token === '--approver') options.approver = requireValue(args, ++index, token);
    else if (token.startsWith('--approver=')) options.approver = token.slice('--approver='.length);
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  if (Object.keys(exception).length && !exceptionRequested) throw new Error('exception evidence requires --test-exception');
  if (exceptionRequested) options.testException = exception;
  return options;
}

function requireValue(args, index, option) {
  if (!args[index]) throw new Error(`${option} requires a value`);
  return args[index];
}

function printResult(result) {
  if (['test-target', 'base-sync'].includes(result.kind)) { console.log(JSON.stringify(result, null, 2)); return; }
  if (['hotfix-init', 'hotfix-revision'].includes(result.kind)) {
    console.log(`cc-nexs ${result.kind}: ${result.feature.id}${result.resumed ? ' (resumed)' : ''}`);
    console.log(`BUG: ${result.document}`);
    console.log(`Progress: ${result.progressFile}`);
    if (result.state) console.log(`State: ${result.state}`);
    return;
  }
  if (result.kind === 'feature-status') {
    const { next } = result;
    console.log(`cc-nexs status: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Mode: ${result.input.mode}`);
    console.log(`State: ${result.input.state} (revision ${result.revision})`);
    console.log(`Next: ${next.next}`);
    console.log(`Action: ${next.action}${next.role ? ` (role: ${next.role})` : ''}${next.stop ? ' [stop]' : ''}`);
    if (next.circuitBreaker) console.log(`Circuit breaker: ${next.circuitBreaker}${next.bug ? ` (${next.bug})` : ''}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'feature-advance') {
    console.log(`cc-nexs advance: ${result.feature.id} ${result.from} -> ${result.to} (revision ${result.revision})`);
    if (result.expectedNext && result.expectedNext !== result.to) {
      console.log(`Note: nextStep() expected ${result.expectedNext}; confirm the active rule's failure mapping requires ${result.to}`);
    }
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
  if (result.kind === 'plan-review') {
    console.log(`cc-nexs plan review ${result.status} (round ${result.rounds})`);
    console.log(`State: ${result.state}`);
    console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'worktree-reclaim') {
    if (!result.applied) { for (const line of formatInventory(result)) console.log(line); return; }
    console.log(`cc-nexs reclaimed ${result.removed.length} worktree(s)`);
    for (const entry of result.removed) console.log(`  removed ${entry.display}`);
    for (const entry of result.failed) console.log(`  failed  ${entry.display}: ${entry.error}`);
    if (result.failed.length) process.exitCode = 1;
    return;
  }
  if (result.kind === 'test-conflict-resolved') {
    console.log('cc-nexs test conflict resolved and pushed');
    console.log(`Attempt: ${result.attempt.id}`);
    console.log('Next: release-test --resume (add --hotfix in Hotfix mode) continues this exact attempt');
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (result.kind === 'test-conflict-target-advanced') {
    console.log(`cc-nexs test target advanced during conflict resolution (${result.repository}); nothing was pushed`);
    console.log(`Retired attempt: ${result.attempt.id}`);
    console.log('Next: release-test (add --hotfix in Hotfix mode) integrates the new tip; recorded resolutions are replayed for confirmation');
    console.log(`Progress: ${result.progressFile}`);
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
    if (['deploying', 'awaiting_receipt'].includes(result.attempt?.status)) console.log('CI/CD: deploying; resume this exact attempt with release-test --resume');
    if (result.verificationPrerequisites?.ready === false) {
      console.log(`Post-deploy verification prerequisites pending: ${result.verificationPrerequisites.missing.join(', ')}`);
    }
    console.log(`Progress: ${result.progressFile}`);
    return;
  }
  if (typeof result.gate !== 'string') { console.log(JSON.stringify(result, null, 2)); return; }
  const gate = result.gate.toUpperCase();
  const status = result.alreadyApproved ? 'already approved' : 'approved';
  console.log(`cc-nexs ${gate} ${status}`);
  console.log(`Feature: ${result.feature.id} ${result.feature.slug}`);
  console.log(`State: ${result.state}`);
  console.log(`Approver: ${result.approver}`);
  console.log(`Approved at: ${result.approvedAt}`);
  console.log(`Progress: ${result.progressFile}`);
}

function printUsage() {
  console.error('Usage:');
  console.error('  cc-nexs status <feature-id> [--no-auto-test-release] [--progress <path>]');
  console.error('  cc-nexs advance <feature-id> --from <state> --to <state> [--reason <text>] [--progress <path>]');
  console.error('  cc-nexs resolve-test-conflict <feature-id> [--progress <path>]');
  console.error('  cc-nexs reclaim-worktrees [--sizes] [--confirm <token>]');
  console.error('  cc-nexs switch-test-target --request <json-file>');
  console.error('  cc-nexs revise-hotfix <bug-key> --reason <text> --authorization-evidence <text> [--promote-lean] [--progress <path>]');
  console.error('  cc-nexs approve-plan <feature-id> [--approver <name>] [--progress <path>]');
  console.error('  cc-nexs approve-release <feature-id> [--approver <name>] [--progress <path>]');
  console.error('    [--test-exception --authorization-evidence <text> --reason <text> --environment-evidence <text> --rollback-evidence <text>]');
  console.error('  cc-nexs release-test <feature-id> [--resume | --retry] [--dry-run] [--hotfix] [--progress <path>]');
  console.error('  cc-nexs verify-local <feature-id> [--passed|--failed|--deferred-to-test --evidence-json <json>] [--progress <path>]');
  console.error('  cc-nexs record-review <feature-id> <--passed|--blocked> [--finding <P0/P1 text>] [--closure|--gateway-b-delta] [--progress <path>]');
  console.error('  cc-nexs record-plan-review <feature-id> <--passed|--blocked> [--finding <P0/P1 text>] [--progress <path>]');
  console.error('  cc-nexs start-hotfix <feature-id> [--level <P0|P1|P2|P3>] [--related <feature-id>] [--progress <path>]');
  console.error('  cc-nexs assert-hotfix-candidate <feature-id> [--progress <path>]');
  console.error('  cc-nexs record-test-verification <feature-id> <--passed|--blocked|--manual-required> --evidence <text> [--attempt <id>] [--progress <path>]');
  console.error('  cc-nexs request-release-changes <feature-id> --type <evidence|implementation|scope> --feedback <text> [--ac <id>] [--path <path>] [--progress <path>]');
  console.error('  cc-nexs release-base <feature-id> [--progress <path>]');
  console.error('  cc-nexs render-plan <feature-id> [--progress <path>]');
  console.error('  cc-nexs migrate-feature-config <feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]');
  console.error('  cc-nexs model-gateway <inspect|prepare|view|start|feedback|result> --request <json-file>');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  let result;
  try {
    result = runCcNexsCommand(process.argv.slice(2));
  } catch (error) {
    // Controller errors may follow durable side effects; usage text would imply a syntax mistake.
    if (!error.message.startsWith('[cc-nexs]')) printUsage();
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
  if (result) {
    try { printResult(result); }
    catch (error) { console.error(`Warning: command completed; output rendering failed: ${error.message}`); console.log(JSON.stringify({ kind: result.kind, progressFile: result.progressFile }, null, 2)); }
  }
}
