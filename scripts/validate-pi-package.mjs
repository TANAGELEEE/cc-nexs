#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const expectedCommands = [
  'approve-deploy',
  'approve-spec',
  'brainstorm',
  'build',
  'doctor',
  'fullstack',
  'git-custodian',
  'hotfix',
  'init',
  'migrate-progress',
  'recon',
  'review',
  'run',
  'status',
  'verify',
];
const expectedRoles = [
  'fullstack',
  'repo-scout',
  'reviewer',
  'verifier',
];

function fail(message) {
  errors.push(message);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!packageJson.keywords?.includes('pi-package')) fail('package.json: missing pi-package keyword');
if (packageJson.pi?.extensions?.[0] !== './pi/extensions/cc-nexs.ts') fail('package.json: invalid Pi extension path');
if (!packageJson.pi?.skills?.includes('./pi/skills')) fail('package.json: missing Pi skills path');
if (!packageJson.pi?.subagents?.agents?.includes('./pi/agents')) fail('package.json: missing pi-subagents agent path');

const extensionPath = join(root, 'pi/extensions/cc-nexs.ts');
if (!existsSync(extensionPath)) fail('Pi extension is missing');
else {
  const extension = readFileSync(extensionPath, 'utf8');
  for (const marker of ['CC_NEXS_RUNTIME = "pi"', 'PI_SUBAGENT_CHILD_AGENT', 'pi.registerCommand', 'isGitMutation', 'roleBoundaryViolation']) {
    if (!extension.includes(marker)) fail(`Pi extension: missing ${marker}`);
  }
  for (const marker of ['runCcNexsCommand', 'splitCommandArguments']) {
    if (!extension.includes(marker)) fail(`Pi extension: missing deterministic approval marker ${marker}`);
  }
  for (const command of expectedCommands) {
    if (!extension.includes(`"${command}"`)) fail(`Pi extension: missing command ${command}`);
  }
}

const skillsRoot = join(root, 'pi/skills');
const skillNames = existsSync(skillsRoot) ? readdirSync(skillsRoot).sort() : [];
for (const command of expectedCommands) {
  const name = `cc-nexs-${command}`;
  if (!skillNames.includes(name)) fail(`Pi skill missing: ${name}`);
  const skillPath = join(skillsRoot, name, 'SKILL.md');
  if (!existsSync(skillPath)) continue;
  const skill = readFileSync(skillPath, 'utf8');
    for (const marker of ['preset-standard', 'fast mode', 'pi-subagents', 'different from the implementation model', 'ships no fixed model IDs']) {
      if (!skill.includes(marker)) fail(`${name}: missing P2 contract marker ${marker}`);
    }
    if (['cc-nexs-approve-deploy', 'cc-nexs-approve-spec'].includes(name)
      && !skill.includes('../../../packages/core/lib/cc-nexs-cli.mjs')) {
      fail(`${name}: approval skill must invoke the deterministic control CLI`);
    }
}
for (const unexpected of skillNames.filter((name) => !expectedCommands.includes(name.replace(/^cc-nexs-/, '')))) {
  fail(`Pi P2 exposes unsupported command skill: ${unexpected}`);
}

const hotfixSkillPath = join(skillsRoot, 'cc-nexs-hotfix', 'SKILL.md');
if (existsSync(hotfixSkillPath)) {
  const hotfixSkill = readFileSync(hotfixSkillPath, 'utf8');
  for (const marker of [
    'Pi Hotfix Dispatch Contract',
    'phase=hotfix-p3',
    'phase=hotfix-implement',
    'target=hotfix-code',
    'target=hotfix-regression-case',
    'target=hotfix-accept',
    'three failed review rounds',
  ]) {
    if (!hotfixSkill.includes(marker)) fail(`cc-nexs-hotfix: missing ${marker}`);
  }
  if (hotfixSkill.includes('request is hotfix/compound')) fail('cc-nexs-hotfix: still rejects the hotfix flow');
}

const agentsRoot = join(root, 'pi/agents');
const agentFiles = existsSync(agentsRoot) ? readdirSync(agentsRoot).filter((file) => file.endsWith('.md')).sort() : [];
for (const role of expectedRoles) {
  const file = `${role}.md`;
  if (!agentFiles.includes(file)) fail(`Pi package agent missing: ${role}`);
  const path = join(agentsRoot, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  for (const marker of [`name: ${role}`, 'package: cc-nexs', 'defaultContext: fresh']) {
    if (!frontmatter.includes(marker)) fail(`${file}: missing ${marker}`);
  }
  if (/^model:/m.test(frontmatter)) fail(`${file}: public package agent must not pin a model`);
  if (!text.includes('# Pi Runtime Override')) fail(`${file}: missing Pi runtime override`);
  if (/^\s*codex\s+/m.test(text)) fail(`${file}: executable Codex CLI snippet leaked into Pi agent`);
}

for (const [role, marker] of Object.entries({
  fullstack: 'phase=hotfix-implement',
  reviewer: 'target=hotfix-code',
  verifier: 'target=hotfix-regression-case',
})) {
  const text = readFileSync(join(agentsRoot, `${role}.md`), 'utf8');
  if (!text.includes('# Pi Hotfix Override') || !text.includes(marker)) {
    fail(`${role}.md: missing Pi hotfix role override`);
  }
}

if (errors.length) {
  console.error('Pi package validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Pi package validation passed: ${expectedCommands.length} P2 commands, ${expectedRoles.length} isolated roles, no fixed models.`);
