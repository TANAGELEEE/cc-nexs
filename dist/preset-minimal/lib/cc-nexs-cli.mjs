#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { approveFeatureGate } from './approval-command.mjs';
import { runBaseRelease } from './base-release.mjs';
import { assertHotfixCandidate, startHotfix } from './hotfix-control.mjs';
import { runLocalVerification } from './local-verify.mjs';
import { recordLeanReview } from './review-control.mjs';
import { requestReleaseChanges } from './release-change-command.mjs';
import { renderLeanPlan } from './plan-render.mjs';
import { runTestRelease } from './test-release.mjs';
import { recordEnvironmentVerification } from './test-verification-control.mjs';

export function runCcNexsCommand(argv, { cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  if (command === 'release-test') {
    return runTestRelease({ cwd, ...parseReleaseOptions(args) });
  }
  if (command === 'release-base') {
    return runBaseRelease({ cwd, ...parseFeatureOptions(args) });
  }
  if (command === 'verify-local') {
    return runLocalVerification({ cwd, ...parseFeatureOptions(args) });
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
    else if (token === '--attempt') options.attemptId = requireValue(args, ++index, token);
    else if (token.startsWith('--attempt=')) options.attemptId = token.slice('--attempt='.length);
    else if (token === '--evidence') options.evidence.push(requireValue(args, ++index, token));
    else if (token.startsWith('--evidence=')) options.evidence.push(token.slice('--evidence='.length));
    else if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
  if (!['passed', 'blocked'].includes(options.status)) throw new Error('record-test-verification requires exactly one of --passed or --blocked');
  if (positional.length > 1) throw new Error(`unexpected arguments: ${positional.slice(1).join(' ')}`);
  return options;
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
  const options = { featureId: null, progressPath: null, retry: false, dryRun: false, hotfix: false, capabilityAttested: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--progress') options.progressPath = requireValue(args, ++index, token);
    else if (token.startsWith('--progress=')) options.progressPath = token.slice('--progress='.length);
    else if (token === '--retry') options.retry = true;
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--hotfix') options.hotfix = true;
    else if (token === '--capability-attested') options.capabilityAttested = true;
    else if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    else positional.push(token);
  }
  options.featureId = positional[0] || null;
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
      console.log(`Repository: ${repo.id} ${repo.sourceCommit} -> ${repo.targetBranch}`);
    }
    if (result.attempt) console.log(`Attempt: ${result.attempt.id}`);
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
  console.error('  cc-nexs release-test <feature-id> [--retry] [--dry-run] [--hotfix] [--capability-attested] [--progress <path>]');
  console.error('  cc-nexs verify-local <feature-id> [--progress <path>]');
  console.error('  cc-nexs record-review <feature-id> <--passed|--blocked> [--finding <P0/P1 text>] [--closure|--gateway-b-delta] [--progress <path>]');
  console.error('  cc-nexs start-hotfix <feature-id> [--level <P0|P1|P2|P3>] [--related <feature-id>] [--progress <path>]');
  console.error('  cc-nexs assert-hotfix-candidate <feature-id> [--progress <path>]');
  console.error('  cc-nexs record-test-verification <feature-id> <--passed|--blocked> --evidence <text> [--attempt <id>] [--progress <path>]');
  console.error('  cc-nexs request-release-changes <feature-id> --type <evidence|implementation|scope> --feedback <text> [--ac <id>] [--path <path>] [--progress <path>]');
  console.error('  cc-nexs release-base <feature-id> [--progress <path>]');
  console.error('  cc-nexs render-plan <feature-id> [--progress <path>]');
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
