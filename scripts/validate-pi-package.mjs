#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const expectedCommands = [
  'approve-deploy',
  'approve-plan',
  'approve-release',
  'approve-spec',
  'brainstorm',
  'build',
  'doctor',
  'fullstack',
  'git-custodian',
  'hotfix',
  'init',
  'lean-review',
  'lean-verify',
  'migrate-progress',
  'migrate-feature-config',
  'recon',
  'release-test',
  'release-base',
  'render-plan',
  'request-release-changes',
  'review',
  'run',
  'status',
  'verify',
  'verify-local',
  'plan',
  'execute',
];
const expectedRoles = [
  'fullstack',
  'repo-scout',
  'reviewer',
  'verifier',
  'lean-planner',
  'lean-developer',
  'lean-reviewer',
  'lean-verifier',
  'hotfix-developer',
  'hotfix-reviewer',
  'hotfix-verifier',
  'verifier-computer-use',
  'lean-verifier-computer-use',
  'hotfix-verifier-computer-use',
];
const explicitAgentTriggerPrefix = 'Only dispatch after the user explicitly invokes a cc-nexs command or skill; never auto-trigger for ordinary natural-language requests.';

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
    const skillFrontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    if (!/^disable-model-invocation:\s*true\s*$/m.test(skillFrontmatter)) {
      fail(`${name}: explicit-only Pi skill must set disable-model-invocation: true`);
    }
    const contractMarkers = command === 'hotfix'
      ? ['preset-standard', 'pi-subagents', 'same model with higher thinking', 'P0/P1 automatically routes Reviewer to escalated', 'explicit feature role profile remains final', 'ship no provider-specific model IDs']
      : ['preset-standard', 'lean (default)', 'pi-subagents', 'same model with higher thinking', 'pass the selected `model` and `thinking` directly', 'automatic risk routing', 'Lean high/critical', 'Hotfix P0/P1', 'explicit feature role profile remains final', 'ship no provider-specific model IDs'];
    for (const marker of contractMarkers) {
      if (!skill.includes(marker)) fail(`${name}: missing P2 contract marker ${marker}`);
    }
    if (['cc-nexs-approve-deploy', 'cc-nexs-approve-spec', 'cc-nexs-approve-plan', 'cc-nexs-approve-release'].includes(name)
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
    'cc-nexs.hotfix-developer',
    'cc-nexs.hotfix-reviewer',
    'cc-nexs.hotfix-verifier',
    'single lifetime delta Review',
    'Never merge test into base',
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
  if (!frontmatter.includes(explicitAgentTriggerPrefix)) {
    fail(`${file}: package role must be scoped to an explicitly invoked cc-nexs workflow`);
  }
  if (/^model:/m.test(frontmatter)) fail(`${file}: public package agent must not pin a model`);
  if (!text.includes('# Pi Runtime Override')) fail(`${file}: missing Pi runtime override`);
  if (/^\s*codex\s+/m.test(text)) fail(`${file}: executable Codex CLI snippet leaked into Pi agent`);
}

for (const file of ['verifier.md', 'lean-verifier.md', 'hotfix-verifier.md']) {
  const verifier = readFileSync(join(agentsRoot, file), 'utf8');
  const frontmatter = verifier.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  if (!/^tools:.*\bbash\b/m.test(frontmatter)) fail(`${file}: ego lite browser operations require Bash`);
  if (!/^skills:\s*ego-browser\s*$/m.test(frontmatter)) fail(`${file}: must select the ego-browser skill`);
  if (!verifier.includes('Pi Ego Lite Browser Contract')) fail(`${file}: missing ego lite browser contract`);
  for (const tool of ['find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'act_ui', 'read_text', 'wait_for']) {
    if (new RegExp(`^tools:.*\\b${tool}\\b`, 'm').test(frontmatter)) fail(`${file}: must not expose fallback tool ${tool}`);
  }
}

for (const file of ['verifier-computer-use.md', 'lean-verifier-computer-use.md', 'hotfix-verifier-computer-use.md']) {
  const verifier = readFileSync(join(agentsRoot, file), 'utf8');
  const frontmatter = verifier.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  if (/^skills:/m.test(frontmatter)) fail(`${file}: fallback verifier must not preload ego-browser`);
  for (const tool of ['find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'act_ui', 'read_text', 'wait_for']) {
    if (!new RegExp(`^tools:.*\\b${tool}\\b`, 'm').test(frontmatter)) fail(`${file}: missing computer-use tool ${tool}`);
  }
  for (const marker of ['Pi Headless Computer Use Browser Contract', '@injaneity/pi-computer-use@0.4.3', 'headless: true']) {
    if (!verifier.includes(marker)) fail(`${file}: missing ${marker}`);
  }
}

for (const command of ['verify-local', 'release-base', 'render-plan', 'migrate-feature-config']) {
  const skill = readFileSync(join(skillsRoot, `cc-nexs-${command}`, 'SKILL.md'), 'utf8');
  if (!skill.includes('Deterministic Lean Control')) fail(`cc-nexs-${command}: missing deterministic Lean control`);
}
const gatewayBChangeSkill = readFileSync(join(skillsRoot, 'cc-nexs-request-release-changes', 'SKILL.md'), 'utf8');
if (!gatewayBChangeSkill.includes('Deterministic Gateway B Change Control')) {
  fail('cc-nexs-request-release-changes: missing deterministic Gateway B change control');
}

const releaseSkillPath = join(skillsRoot, 'cc-nexs-release-test', 'SKILL.md');
if (existsSync(releaseSkillPath)) {
  const releaseSkill = readFileSync(releaseSkillPath, 'utf8');
  for (const marker of ['Deterministic Test Release Control', 'release-test <feature-id>', 'ego-browser nodejs', '@injaneity/pi-computer-use@0.4.3', 'headless: true']) {
    if (!releaseSkill.includes(marker)) fail(`cc-nexs-release-test: missing ${marker}`);
  }
}

if (errors.length) {
  console.error('Pi package validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Pi package validation passed: ${expectedCommands.length} explicit-only P2 commands, ${expectedRoles.length} isolated roles, no fixed models.`);
