#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { approveFeatureGate } from './approval-command.mjs';

export function runCcNexsCommand(argv, { cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  const gate = command === 'approve-spec'
    ? 'g1'
    : command === 'approve-deploy' ? 'g2' : null;
  if (!gate) throw new Error(`unsupported command: ${command || '(missing)'}`);

  const options = parseApprovalOptions(args);
  return approveFeatureGate({ cwd, gate, ...options });
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
