#!/usr/bin/env node
// Validate the load-bearing SOP parity contract shared by Claude Code, Codex, and Pi.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC_NEXS = join(ROOT, 'packages', 'preset-standard');
const DIST_NEXS = join(ROOT, 'dist', 'preset-standard');

const errors = [];

function fail(message) {
  errors.push(message);
}

function read(path) {
  if (!existsSync(path)) {
    fail(`${path}: missing`);
    return '';
  }
  return readFileSync(path, 'utf-8');
}

function mustContain(path, text, patterns) {
  for (const pattern of patterns) {
    const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
    if (!ok) fail(`${path}: missing required SOP marker ${pattern.toString()}`);
  }
}

function normalizeSkillName(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function extractCommandName(commandText, commandFile) {
  const h1 = commandText.match(/^#\s+(\/[^\s]+)/m);
  if (h1) return h1[1].trim();
  return `/cc-nexs:${basename(commandFile, extname(commandFile))}`;
}

function validatePresetModes() {
  const path = join(SRC_NEXS, 'preset.yml');
  const text = read(path);
  mustContain(path, text, [
    'modes:',
    'lean:',
    'hotfix:',
    'full:',
    'fast:',
    'state_machine: lean',
    'state_machine: hotfix',
    'state_machine: full',
    'state_machine: fast',
    '- repo-scout',
    '- planner',
    '- tech-lead',
    '- sa',
    '- qa',
    '- evaluator',
    '- fullstack',
    '- reviewer',
    '- verifier',
    '- lean-planner',
    '- lean-developer',
    '- lean-reviewer',
    '- lean-verifier',
    '- hotfix-developer',
    '- hotfix-reviewer',
    '- hotfix-verifier',
    'default_mode: lean',
    'model_profile: review',
    'routing:',
    'lean-high-risk',
    'hotfix-p0-p1',
    'escalated:',
    'local_verify:',
    'review_revision: 2',
    'fix_per_bug: 2',
    'evaluator_reject: 2',
    'doc_dir: "all-docs/doc/{id}.{slug}/"',
    'doc_repo: "all-docs/"',
    'bugs_dir: "bugs/"',
    'sprint_delivery: final_only',
    'policy: auto_if_ready',
    'claude_provider: chrome-devtools-mcp',
    'codex_provider: current-browser-session',
  'pi_provider: ego-lite',
  'provider: "@injaneity/pi-computer-use@0.4.3"',
  'headless: true',
  ]);
}

function validateInitCommand() {
  const path = join(SRC_NEXS, 'commands', 'init.md');
  const text = read(path);
  mustContain(path, text, [
    '--mode=lean|hotfix|fast|full',
    '--risk-tier=auto|low|medium|high|critical',
    /(?:默认 `lean`|new requirements default to `lean`)/,
    'createWorkspaceWorktrees',
    '.worktrees/<id>-<slug>/<repo-id>/',
    'templates/${MODE}/',
    '"mode"',
    'requirements.md',
    'progress.md',
    'progress.json',
    'config.json',
    'config_version',
    'risk_tier',
    'plan.md',
    'init-hotfix',
    /(?:Hotfix 提前分流|Hotfix Early Routing)/,
    /(?:不运行后续编号|subsequent numbering[^\n]*do not run)/,
  ]);
}

function validateRunCommand() {
  const path = join(ROOT, 'packages', 'core', 'commands', 'run.md');
  const text = read(path);
  mustContain(path, text, [
    'after a stage completes, immediately enter the next stage',
    'Stop only at Lean Gateway A/B',
    'PLAN_PENDING_HUMAN',
    'CONSOLIDATED_REVIEW',
    'RELEASE_PENDING_HUMAN',
    'BASE_MERGING',
    'SPEC_PENDING_HUMAN',
    'DEPLOY_GATE',
    'MODE=$(grep -oE',
    'lean|full|fast|lite|hotfix',
    'Role → command dispatch table',
    '/cc-nexs:recon',
    '/cc-nexs:planner',
    '/cc-nexs:dev <id> --mode=feat --sprint=N',
    '/cc-nexs:qa cases',
    '/cc-nexs:evaluator',
    '/cc-nexs:fullstack <id> --phase=spec',
    '/cc-nexs:review accept <id>',
    '/cc-nexs:verify regression <id>',
    'fast 模式解析',
    'Artifact completeness gate',
    'deploy.md api-doc.md test-report.md',
    'Git Custodian',
    'candidate commit',
    'progress.json',
    'HOTFIX_RELEASE_PENDING_HUMAN',
    'syncFeatureReadme',
    '--no-auto-test-release',
    'ALL_SPRINTS_DEV_DONE',
    'INTEGRATION_REVIEW',
    'TEST_RELEASE',
    'FINAL_QA_BLOCKED',
    '/cc-nexs:release-test',
    '/cc-nexs:plan <id>',
    '/cc-nexs:execute <id>',
    '/cc-nexs:lean-review <id>',
    '/cc-nexs:verify-local <id>',
    '/cc-nexs:approve-release <id>',
    '/cc-nexs:request-release-changes <id>',
    'GATEWAY_B_CHANGE_REQUESTED',
    'SCOPE_CHANGE_REQUESTED',
    '完整 Review 只有一次；修复只允许一次 delta closure',
    'migrate-feature-config',
    "modelGateway('prepare'",
    "modelGateway('start'",
    'featureConfig',
    'matched_rules',
    'fanout: implementation_repositories',
    'sync-implementation-worktrees',
    'implementation-delta begin',
    'implementation-delta end',
    'validate-implementation-plan',
    'exactly one candidate refresh per changed repository',
    'CC_NEXS_PROGRESS_FILE',
    'progress.hotfix_document',
    '--test-exception',
  ]);
}

function validateParallelImplementationRules() {
  const fastPath = join(ROOT, 'packages', 'core', 'rules', 'run-fast.md');
  const fullPath = join(ROOT, 'packages', 'core', 'rules', 'run-full.md');
  const plannerPath = join(ROOT, 'packages', 'preset-standard', 'commands', 'planner.md');
  const fullstackPath = join(ROOT, 'packages', 'preset-standard', 'commands', 'fullstack.md');
  mustContain(fastPath, read(fastPath), [
    'Multi-end implementation fanout',
    '--assignment=<IMP-id>',
    '--phase=build-sync',
    'launch all batch members together',
    'implementation-delta begin <id>',
    'implementation-delta end <id> --token <token>',
    'subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })',
    'subagent_wait({ id })',
    'exactly one candidate per changed repository',
  ]);
  mustContain(fullPath, read(fullPath), [
    'Multi-end implementation fanout',
    '--assignment=<IMP-id>',
    'QA `write_cases` and all first-wave Tech Lead workers together',
    'implementation-delta begin <id>',
    '--allow-doc-path test-cases.md --allow-doc-path qa-scripts/**',
    'implementation-delta end <id> --token <token>',
    'subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })',
    'subagent_wait({ id })',
    'exactly one candidate per changed repository',
  ]);
  mustContain(plannerPath, read(plannerPath), [
    'sync-implementation-worktrees',
    'validate-implementation-plan',
    /(?:G1 前|before G1)/,
  ]);
  mustContain(fullstackPath, read(fullstackPath), [
    'sync-implementation-worktrees',
    'validate-implementation-plan',
    /(?:G1 前|before G1)/,
  ]);
}

function validateHotfixCommand() {
  const path = join(SRC_NEXS, 'commands', 'hotfix.md');
  const text = read(path);
  mustContain(path, text, [
    'P0',
    'P1',
    'P2',
    'P3',
    'mode=hotfix',
    'hotfix.md',
    'init-hotfix',
    'hotfix/<key>',
    '.cc-nexs/hotfixes/<key>/',
    'progress.hotfix_document',
    'doc/<id>.<slug>/bugs/BUG-<key>.md',
    'hotfix/<key>/BUG-001.md',
    'revise-hotfix',
    '--authorization-evidence',
    '--promote-lean',
    '--test-exception',
    /(?:P0\/P1\/P2\/P3 全部需要独立 Review|P0\/P1\/P2\/P3 all require an independent Review)/,
    'HOTFIX-SCOPE',
    'start-hotfix',
    'HOTFIX_LOCAL_VERIFYING',
    'HOTFIX_DELTA_REVIEW',
    'HOTFIX_TEST_RELEASE',
    'HOTFIX_RELEASE_PENDING_HUMAN',
    /(?:同一模型但更高 effort\/thinking|same model with higher effort\/thinking)/,
    /(?:P0\/P1 的 Reviewer 自动路由到 `escalated`|Reviewer for P0\/P1 is automatically routed to `escalated`)/,
    'Git Custodian',
    'release-test <id> --hotfix',
    '/cc-nexs:approve-release <id>',
    /(?:禁止 `test -> base`|`test -> base`[^\n]*prohibited)/,
  ]);
  for (const obsolete of ['完成新编号、占号和 worktree 初始化', 'P3 最终 diff 不满足边界时升级 P2', '机器边界证明后跳过模型 Review']) {
    if (text.includes(obsolete)) fail(`${path}: obsolete Hotfix contract ${obsolete}`);
  }
  const templatePath = join(SRC_NEXS, 'templates', 'hotfix', 'hotfix.md');
  const template = read(templatePath);
  const boundScope = template.split('<!-- HOTFIX-SCOPE START -->')[1]?.split('<!-- HOTFIX-SCOPE END -->')[0] || '';
  mustContain(templatePath, boundScope, ['intended_paths:', 'affected_acs:', 'rollback_owner:', 'rollback_steps:', '| Check |', '命令/Driver']);
  const approvalPath = join(ROOT, 'packages', 'core', 'commands', 'approve-release.md');
  mustContain(approvalPath, read(approvalPath), ['--test-exception', '--authorization-evidence', '--environment-evidence', '--rollback-evidence', 'not production deployment', 'manual_required']);
  for (const name of ['revise-hotfix']) {
    const commandPath = join(ROOT, 'packages', 'core', 'commands', `${name}.md`);
    mustContain(commandPath, read(commandPath), [`# /cc-nexs:${name}`, `cc-nexs-cli.mjs ${name}`]);
  }
}

function validateMirrorSkill(commandName, commandFile) {
  const skillPath = join(DIST_NEXS, 'codex-skills', commandName, 'SKILL.md');
  const text = read(skillPath);
  mustContain(skillPath, text, [
    `../../commands/${commandFile}`,
    'single source of truth',
    'Document Write Map',
    'Full / Fast / Hotfix Mode Locks',
    'all-docs/doc/{id}.{slug}/',
    'hotfix.md',
    '.cc-nexs/hotfixes/<key>/',
    'progress.hotfix_document',
    'docs/solutions/',
    'progress.md',
    'full',
    'lean',
    'fast',
    'hotfix',
  ]);
}

function validateAllGeneratedMirrors() {
  const commandsRoot = join(DIST_NEXS, 'commands');
  const codexSkillsRoot = join(DIST_NEXS, 'codex-skills');
  if (!existsSync(commandsRoot)) {
    fail(`${commandsRoot}: missing`);
    return;
  }
  for (const fileName of readdirSync(commandsRoot).filter((entry) => entry.endsWith('.md')).sort()) {
    const commandText = read(join(commandsRoot, fileName));
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    const skillPath = join(codexSkillsRoot, skillName, 'SKILL.md');
    const text = read(skillPath);
    mustContain(skillPath, text, [
      `../../commands/${fileName}`,
      'single source of truth',
      'Document Write Map',
      'Full / Fast / Hotfix Mode Locks',
      'all-docs/doc/{id}.{slug}/',
      'hotfix.md',
      '.cc-nexs/hotfixes/<key>/',
      'progress.hotfix_document',
      'docs/solutions/',
      'progress.md',
    ]);
  }
}

validatePresetModes();
validateInitCommand();
validateRunCommand();
validateParallelImplementationRules();
validateHotfixCommand();
validateMirrorSkill('cc-nexs-init', 'init.md');
validateMirrorSkill('cc-nexs-run', 'run.md');
validateMirrorSkill('cc-nexs-hotfix', 'hotfix.md');
validateMirrorSkill('cc-nexs-revise-hotfix', 'revise-hotfix.md');
validateMirrorSkill('cc-nexs-release-test', 'release-test.md');
validateAllGeneratedMirrors();

for (const file of [
  join(DIST_NEXS, 'commands', 'init-hotfix.md'),
  join(DIST_NEXS, 'codex-skills', 'cc-nexs-init-hotfix', 'SKILL.md'),
  join(ROOT, 'pi', 'skills', 'cc-nexs-init-hotfix', 'SKILL.md'),
]) {
  if (existsSync(file)) fail(`${file}: redundant public Hotfix initialization entry`);
}

if (errors.length > 0) {
  console.error('SOP parity validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('SOP parity validation passed: lean-default, full, fast, hotfix, document paths, Codex mirrors');
