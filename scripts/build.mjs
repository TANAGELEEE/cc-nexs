#!/usr/bin/env node
// cc-nexs build: 把 monorepo 源码物化成扁平 plugin。
// 输入：packages/core/* + packages/preset-<name>/*
// 输出：dist/<preset-name>/  ← 自包含 Claude Code + Codex Plugin
//
// 物化策略:
//   1. preset 自有资源直接拷（commands / agents / skills / templates / preset.yml）
//   2. core/commands 拷进 dist/commands（preset 同名命令优先，不被覆盖）
//   3. core/hooks 拷进 dist/hooks/（preset 的 hooks/hooks.json 和它们一起）
//   4. core/lib 拷进 dist/lib（commands 文本里引用的 "core/lib/X.mjs" → "lib/X.mjs"）
//   5. core/schemas 拷进 dist/schemas
//   6. core/i18n + preset/i18n（如有）merge 进 dist/i18n
//   7. .claude-plugin/plugin.json + .codex-plugin/plugin.json 从 preset 拷，version 同步根 package.json
//   8. 所有文本类文件做路径 rewrite：
//        "core/lib/"   → "lib/"
//        "_core/"      → ""        (例如 "_core/hooks/x.mjs" → "hooks/x.mjs")
//        "../core/"    → ""        (例如 "../core/commands/run.md" → "commands/run.md")
//   9. Codex 额外生成 command mirror skills：每个 commands/*.md 都成为一个可触发 skill，
//      保证 /cc-nexs:* 的 lean / full / fast / hotfix SOP 仍以同一份 command 文档为事实来源。
//
// 用法:
//   node scripts/build.mjs                # 构建全部 preset
//   node scripts/build.mjs preset-standard     # 仅构建一个

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPresetName,
  assertWithin,
  copyTreeNoSymlinks,
  safeRemoveWithin,
} from './lib/safe-fs.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PACKAGES = join(ROOT, 'packages');
const DIST = join(ROOT, 'dist');

const ROOT_PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = ROOT_PKG.version;
const RELEASE_PRESETS = readReleasePresets();
const PI_ROOT = join(ROOT, 'pi');
const LEAN_ONLY_CORE_COMMANDS = new Set([
  'approve-plan.md',
  'approve-release.md',
  'release-base.md',
  'render-plan.md',
  'request-release-changes.md',
  'verify-local.md',
]);
const PI_P2_COMMANDS = new Set([
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
]);
const PI_ROLE_SOURCES = {
  'repo-scout': 'repo-scout-claude.md',
  fullstack: 'fullstack-claude.md',
  reviewer: 'reviewer-codex.md',
  verifier: 'verifier-codex.md',
  'lean-planner': 'lean-planner.md',
  'lean-developer': 'lean-developer.md',
  'lean-reviewer': 'lean-reviewer.md',
  'lean-verifier': 'lean-verifier.md',
  'hotfix-developer': 'hotfix-developer.md',
  'hotfix-reviewer': 'hotfix-reviewer.md',
  'hotfix-verifier': 'hotfix-verifier.md',
};
const PI_ROLE_ADDENDA = {};

// ---- helpers ---------------------------------------------------------------

function copyDir(src, dst, { skipExisting = false } = {}) {
  return copyTreeNoSymlinks(src, dst, {
    skipExisting,
    exclude: (_path, entry) =>
      entry === 'fixtures'
      || entry === '__fixtures__'
      || entry === '__tests__'
      || /\.(?:test|spec)\.[cm]?[jt]s$/.test(entry),
  });
}

const TEXT_EXTS = new Set(['.md', '.mjs', '.js', '.json', '.yml', '.yaml', '.sh']);

function rewriteTextPaths(file) {
  if (!TEXT_EXTS.has(extname(file))) return false;
  let text = readFileSync(file, 'utf-8');
  const before = text;
  text = text
    .replace(/(@cc-nexs\/core\/lib\/)/g, 'lib/')
    .replace(/(@cc-nexs\/core\/lib\/)/g, 'lib/')
    .replace(/\bcore\/lib\//g, 'lib/')
    .replace(/_core\/(hooks|commands|lib|schemas|i18n)\//g, '$1/')
    .replace(/\.\.\/core\/(hooks|commands|lib|schemas|i18n)\//g, '$1/');
  if (text !== before) {
    writeFileSync(file, text, 'utf-8');
    return true;
  }
  return false;
}

function rewriteAllTextFiles(dir) {
  if (!existsSync(dir)) return 0;
  let touched = 0;
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`symlink is not allowed in build output: ${p}`);
    if (st.isDirectory()) touched += rewriteAllTextFiles(p);
    else if (st.isFile() && rewriteTextPaths(p)) touched += 1;
  }
  return touched;
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

function extractDescription(commandText, commandName) {
  const m = commandText.match(/^description:\s*(.+)$/m);
  const desc = m ? m[1].trim() : `Mirror ${commandName} in Codex.`;
  return desc.replace(/^["']|["']$/g, '');
}

function deterministicControlBlock(commandBase, cliPath) {
  if (commandBase === 'hotfix') {
    return `## Deterministic Hotfix Controls

Resolve \`${cliPath}\` relative to this SKILL.md. Bind the completed hotfix scope with:

\`\`\`text
node <resolved-cli-path> start-hotfix <feature-id> [--level P0|P1|P2|P3] [--related <feature-id>]
\`\`\`

Subsequent local verification, Review recording, test release/verification, release approval, and base integration must use the packaged controls named by the authoritative command. Never edit progress state or perform ad hoc merge/push operations.

`;
  }
  if (commandBase === 'release-test') {
    return `## Deterministic Test Release Control

Complete the runtime/browser capability preflight from the authoritative command before any remote mutation. Then resolve \`${cliPath}\` relative to this SKILL.md and execute:

\`\`\`text
node <resolved-cli-path> release-test <feature-id> --capability-attested [--retry] [--dry-run] [--hotfix]
\`\`\`

Never implement test-branch integration with ad hoc Git commands and never target production. If capability preflight fails, do not invoke the controller; preserve the manual fallback exactly as the command specifies.

`;
  }
  if (commandBase === 'request-release-changes') {
    return `## Deterministic Gateway B Change Control

Resolve \`${cliPath}\` relative to this SKILL.md and execute:

\`\`\`text
node <resolved-cli-path> request-release-changes <feature-id> --type <evidence|implementation|scope> --feedback <text> [--ac <id>] [--path <path>]
\`\`\`

Never edit progress state directly or combine this request with release approval.

`;
  }
  if (['verify-local', 'release-base', 'render-plan'].includes(commandBase)) {
    return `## Deterministic Lean Control

Resolve \`${cliPath}\` relative to this SKILL.md and execute:

\`\`\`text
node <resolved-cli-path> ${commandBase} <feature-id>
\`\`\`

Never replace this control with model-generated progress edits or ad hoc Git commands.

`;
  }
  if (!['approve-deploy', 'approve-spec', 'approve-plan', 'approve-release'].includes(commandBase)) return '';
  const sprint = commandBase === 'approve-deploy' ? ' [M<N>]' : '';
  return `## Deterministic Approval Control

Resolve \`${cliPath}\` relative to this SKILL.md and execute the packaged control program:

\`\`\`text
node <resolved-cli-path> ${commandBase} <feature-id>${sprint}
\`\`\`

Never execute \`/cc-nexs:${commandBase}\` as a shell path and never edit \`progress.json\` or \`progress.md\` directly. After the control program succeeds, continue the current runtime's run workflow.

`;
}

function generateCodexSkills(dst) {
  const commandsDir = join(dst, 'commands');
  const codexSkillsDir = join(dst, 'codex-skills');
  safeRemoveWithin(dst, codexSkillsDir);
  if (!existsSync(commandsDir)) return 0;
  mkdirSync(codexSkillsDir, { recursive: true });
  const supportsLean = existsSync(join(dst, 'templates', 'lean'))
    && readFileSync(join(dst, 'preset.yml'), 'utf8').includes('default_mode: lean');

  const commandFiles = readdirSync(commandsDir)
    .filter((entry) => entry.endsWith('.md'))
    .sort();

  let generated = 0;
  for (const fileName of commandFiles) {
    const commandPath = join(commandsDir, fileName);
    const commandText = readFileSync(commandPath, 'utf-8');
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    if (!skillName) continue;

    const commandBase = basename(fileName, '.md');
    const description = [
      `${commandName} 的 Codex 镜像 skill。`,
      `当用户输入 "${commandName}"、"${commandName} ..."、"$${skillName}" 或要求执行 cc-nexs ${commandBase} 流程时触发。`,
      extractDescription(commandText, commandName),
    ].join(' ');
    const skillRoot = join(codexSkillsDir, skillName);
    mkdirSync(skillRoot, { recursive: true });
    const relCommand = `../../commands/${fileName}`;
    const controlBlock = deterministicControlBlock(commandBase, '../../lib/cc-nexs-cli.mjs');
    const body = `---
name: ${skillName}
description: ${description}
---

# ${commandName} for Codex

This skill is the Codex mirror for \`${commandName}\`. It exists so the Codex plugin can preserve the same command surface, workflow semantics, document write locations, and ${supportsLean ? 'lean / ' : ''}full / fast / hotfix behavior as the Claude Code plugin.

## Authoritative Command

Read and follow \`${relCommand}\` as the single source of truth for this command. Treat the user's original message after \`${commandName}\` as the command arguments.

${controlBlock}## Execution Contract

1. Preserve every document path declared by the command file. Do not relocate \`all-docs/doc/{id}.{slug}/\`, \`doc/{id}.{slug}/\`, \`bugs/\`, \`qa-scripts/\`, \`docs/solutions/\`, or any command-specific artifact.
2. Preserve the command's state-machine contract. If the command says a single-step command must not advance \`progress.md\`, do not advance it; if \`run\` is the orchestrator, let \`run\` own state transitions.
3. Preserve mode behavior exactly:
   - \`full\`: five-role SOP with Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, and sprint loop.
${supportsLean ? '   - `lean`: default plan-first flow with two authored documents, two human gates, deterministic local verification, one consolidated Review, test verification, and approved base integration.\n' : ''}   - \`fast\`: legacy three-role flow with Fullstack / Reviewer / Verifier, single sprint, stricter thresholds, and no TECH_LEAD_REVIEW fallback.
   - \`hotfix\`: standalone mini-Lean flow with its own latest-base feature worktrees, one hotfix.md, bounded Review, test verification, and a human base gate.
4. In Codex, every role runs as an independent native subagent using the role prompt from \`../../agents/\`. Never invoke Claude Code, a Claude subagent tool, or a nested \`codex\` CLI process. Runtime adaptation overrides any Claude-specific shell snippet in the authoritative command.
5. Keep implementation and review in distinct native agent sessions. ${supportsLean ? 'Resolve model profiles from preset < project < feature config. A Lean Reviewer may use a different model or the same model with higher reasoning effort. ' : ''}Provider-specific IDs are allowed only in private project/feature config; public preset defaults remain portable and inherit when unspecified.
6. When a shell snippet references \`$CLAUDE_PLUGIN_ROOT\`, translate it to the installed Codex plugin root that contains this skill. In shell commands prefer \`PLUGIN_ROOT=<plugin-root>\` or \`CC_NEXS_PLUGIN_ROOT=<plugin-root>\` or substitute the absolute plugin root directly.
7. Before editing or creating files, inspect the relevant command, agent, template, and current feature directory. Follow existing repo patterns and keep unrelated files untouched.
8. Run the verification steps requested by the command. If a step cannot be run in the current Codex surface, record the exact limitation and preserve the command's expected stop/gate behavior.

## Document Write Map

These are fixed cc-nexs locations, not Codex-specific alternatives:

- Feature docs: \`all-docs/doc/{id}.{slug}/requirements.md\`, \`repo-context.md\`, \`spec.md\`, \`sa-review.md\`, \`dev-plan.md\`, \`api-doc.md\`, \`deploy.md\`, \`test-cases.md\`, \`sa-test-review.md\`, \`test-report.md\`, \`sa-code-review.md\`, \`acceptance.md\`, \`progress.md\`, and \`README.md\`.
- Hotfix record: \`all-docs/doc/{id}.{slug}/hotfix.md\` in an independently initialized hotfix feature.
- Compound learnings: \`docs/solutions/<topic>.md\` plus the command-specific feature summary when \`/cc-nexs:compound\` requests it.
- Document repo commits: when \`all-docs/\` is its own git repo, add only \`doc/{id}.{slug}/\` or the command-declared bug path and keep code-repo files out of that commit.

## Full / Fast / Hotfix Mode Locks

${supportsLean ? '- `lean`: preserve the plan and release gates, two authored documents, exact worktree/candidate binding, deterministic local driver, one full Review plus at most one delta closure, and test-before-base integration.\n' : ''}- \`full\`: preserve Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, sprint slicing, artifact completeness gate before Evaluator, single human gate after spec approval, and README sync around every state transition.
- \`fast\`: preserve Fullstack / Reviewer / Verifier roles, single sprint, stricter counters, merged Reviewer acceptance parsing, Verifier black-box testing, no SA test-case review, and no TECH_LEAD_REVIEW fallback.
- \`hotfix\`: preserve latest-base isolation, immutable scope binding, P0/P1/P2/P3 impact grading, deterministic P3 boundary, one Review plus at most one lifetime delta, test verification, and Gateway B before base integration.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by \`${relCommand}\` are present in the original cc-nexs locations.
`;

    writeFileSync(join(skillRoot, 'SKILL.md'), body, 'utf-8');
    generated += 1;
  }
  return generated;
}

function parseAgentSource(text, file) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) throw new Error(`Pi agent source has no frontmatter: ${file}`);
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || `cc-nexs role from ${file}`;
  const declaredTools = frontmatter[1].match(/^tools:\s*(.+)$/m)?.[1]?.split(',').map((tool) => tool.trim()) || [];
  const toolMap = new Map([
    ['Read', 'read'],
    ['Write', 'write'],
    ['Edit', 'edit'],
    ['Glob', 'find'],
    ['Grep', 'grep'],
    ['Bash', 'bash'],
  ]);
  const tools = [...new Set(declaredTools.map((tool) => toolMap.get(tool)).filter(Boolean))];
  if ((tools.includes('find') || tools.includes('grep')) && !tools.includes('ls')) tools.push('ls');
  const body = text.slice(frontmatter[0].length)
    .replace(/codex CLI/gi, 'isolated Pi reviewer session')
    .replace(/codex 调用/g, 'Pi child session')
    .replace(/codex 子会话/g, 'Pi child session')
    .replace(/^(\s*)codex\b[^"\n]*"/gm, '$1')
    .replace(/^(\s*)"\s*$/gm, '$1')
    .replace(/"(?=\n```)/g, '');
  return { description, tools, body };
}

function generatePiResources() {
  const standardSource = join(PACKAGES, 'preset-standard');
  const standardDist = join(DIST, 'preset-standard');
  const agentsDir = join(PI_ROOT, 'agents');
  const skillsDir = join(PI_ROOT, 'skills');
  safeRemoveWithin(ROOT, agentsDir);
  safeRemoveWithin(ROOT, skillsDir);
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });

  for (const [role, sourceFile] of Object.entries(PI_ROLE_SOURCES)) {
    const sourcePath = join(standardSource, 'agents', sourceFile);
    const { description, tools, body } = parseAgentSource(readFileSync(sourcePath, 'utf8'), sourceFile);
    if (role === 'verifier' || role === 'lean-verifier' || role === 'hotfix-verifier') {
      tools.push('find_roots', 'observe_ui', 'search_ui', 'inspect_ui', 'act_ui', 'wait_for');
    }
    const header = [
      '---',
      `name: ${role}`,
      'package: cc-nexs',
      `description: ${JSON.stringify(description.replace(/codex CLI/gi, 'Pi subagent').replace(/Claude/gi, 'Pi'))}`,
      `tools: ${tools.join(', ')}`,
      'defaultContext: fresh',
      'systemPromptMode: replace',
      'inheritProjectContext: true',
      'inheritSkills: false',
      '---',
      '',
      '# Pi Runtime Override',
      '',
      'You are already running as an isolated cc-nexs Pi child agent. Execute this role directly.',
      'Any Claude Task-tool, Claude subagent, Codex CLI, or nested agent invocation shown below is legacy runtime syntax only.',
      'Never invoke `claude`, `codex`, another `pi` process, `/cc-nexs:*`, or the `subagent` tool from this child.',
      'The parent orchestrator owns progress transitions and Git Custodian operations. Do not run Git mutation commands.',
      'The parent resolves the cc-nexs role profile and passes model/thinking to the Agent call; do not choose or persist a model ID.',
      '',
      PI_ROLE_ADDENDA[role] || '',
      '# Authoritative Role Contract',
      '',
    ].join('\n');
    writeFileSync(join(agentsDir, `${role}.md`), `${header}${body}`, 'utf8');
  }

  const commandsDir = join(standardDist, 'commands');
  let generated = 0;
  for (const fileName of readdirSync(commandsDir).filter((entry) => entry.endsWith('.md')).sort()) {
    const commandBase = basename(fileName, '.md');
    if (!PI_P2_COMMANDS.has(commandBase)) continue;
    const commandText = readFileSync(join(commandsDir, fileName), 'utf8');
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    const supportsHotfix = commandBase === 'hotfix';
    const controlBlock = deterministicControlBlock(commandBase, '../../../packages/core/lib/cc-nexs-cli.mjs');
    const description = [
      `${commandName} 的 Pi P2 适配 skill。`,
      supportsHotfix
        ? '支持 preset-standard 独立 hotfix mini-Lean，并通过 pi-subagents 运行隔离角色。'
        : '支持 preset-standard lean（默认）与 fast 模式，并通过 pi-subagents 运行隔离角色。',
      extractDescription(commandText, commandName).replace(/codex CLI/gi, 'Pi subagent'),
    ].join(' ');
    const modelGuard = supportsHotfix
      ? 'Resolve Hotfix role profiles from project/feature config. Reviewer may use a different authenticated model or the same model with higher thinking, but always uses a fresh child context. P0/P1 heterogeneity is an optional private policy, not a public preset requirement. Accept ordered fallbackModels.'
      : 'For lean, resolve role profiles from project/feature configuration: the Reviewer may use a different authenticated model or the same model with higher thinking, but must use a fresh child context. For legacy fast, preserve its configured heterogeneous-review guard. Accept ordered fallbackModels.';
    const skillDir = join(skillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    const body = `---
name: ${skillName}
description: ${description}
---

# ${commandName} for Pi

Read and follow \`../../../dist/preset-standard/commands/${fileName}\` as the authoritative command. Treat the text after \`${commandName}\` as its arguments.

${controlBlock}## P2 Runtime Contract

1. Pi support covers \`preset-standard\` lean (default), standalone hotfix, and legacy fast. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed \`pi-subagents\` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: \`cc-nexs.repo-scout\`
   - Fullstack: \`cc-nexs.fullstack\`
   - Reviewer: \`cc-nexs.reviewer\`
   - Verifier: \`cc-nexs.verifier\`
   - Lean Planner: \`cc-nexs.lean-planner\`
   - Lean Developer: \`cc-nexs.lean-developer\`
   - Lean Reviewer: \`cc-nexs.lean-reviewer\`
   - Lean Verifier: \`cc-nexs.lean-verifier\`
   - Hotfix Developer: \`cc-nexs.hotfix-developer\`
   - Hotfix Reviewer: \`cc-nexs.hotfix-reviewer\`
   - Hotfix Verifier: \`cc-nexs.hotfix-verifier\`
3. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested \`pi\` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
4. Resolve Lean profiles from cc-nexs project/feature config and pass the selected \`model\` and \`thinking\` directly to the pi-subagents \`Agent\` call. Omit \`model\` when it is \`inherit\`. If the primary model is unavailable, retry the ordered cc-nexs \`fallback_models\` list. Project \`.pi/settings.json\` remains only the Pi authentication/\`enabledModels\` authority; do not duplicate role mappings there. Public cc-nexs files ship no provider-specific model IDs.
5. ${modelGuard}
6. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
7. Set or preserve \`CC_NEXS_RUNTIME=pi\` and \`CC_NEXS_PLUGIN_ROOT\` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
8. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.

${supportsHotfix ? `## Pi Hotfix Dispatch Contract

1. Hotfix must be initialized as \`mode=hotfix\` with its own id, \`feature/<id>-<slug>\`, and worktrees from the latest configured remote bases. A related feature is metadata only.
2. Fill and bind the sole authored \`hotfix.md\` scope with \`start-hotfix\` before dispatch. AC/API/database/permission contract changes or broad refactoring stop and become a new Lean/Full change.
3. Dispatch \`cc-nexs.hotfix-developer\` for implementation/fix. Candidate Git mutations remain parent Git Custodian work.
4. P0/P1/P2 dispatch \`cc-nexs.hotfix-reviewer\` exactly once; a blocked result permits one fresh delta Review only. P3 skips the model Review only after deterministic one-file, at-most-20-line, non-behavioral proof.
5. Run the configured local verification driver, then release the exact candidate with \`release-test --hotfix\`. Dispatch a fresh \`cc-nexs.hotfix-verifier\` on the deployed environment revision, including P3 smoke and P0/P1 rollback/AC evidence.
6. Reviewer may use a different model or the same model with higher thinking. Session isolation is mandatory; heterogeneity is optional project policy. Public files never pin a model ID.
7. Test failure or Gateway B implementation feedback consumes the same single lifetime delta Review, then requires a new candidate/test attempt. Delta blocking stops for human intervention.
8. Only \`approve-release\` authorizes the verified feature candidate to merge into configured base branches. Never merge test into base and never force push.
` : ''}

## Required Pi Prerequisite

\`pi-subagents\` must be installed and its \`subagent\` tool must expose the package agents above. Run \`/subagents-doctor\`, then open \`/subagents\` to inspect package-agent model mappings. \`/subagents-models\` is only for builtin agents and must not be used for cc-nexs package roles.

Automatic browser verification additionally requires \`@injaneity/pi-computer-use@0.4.3\` installed with \`pi install git:github.com/injaneity/pi-computer-use@v0.4.3\`. If it is absent, keep cc-nexs available and use the manual test-release fallback; do not silently claim browser verification.
`;
    writeFileSync(join(skillDir, 'SKILL.md'), body, 'utf8');
    generated += 1;
  }

  console.log(`\n✓ Pi P2 resources: ${Object.keys(PI_ROLE_SOURCES).length} agents, ${generated} skills`);
}

function deepMergeJSON(a, b) {
  if (b == null) return a;
  if (typeof b !== 'object' || Array.isArray(b)) return b;
  const out = Array.isArray(a) ? [...a] : { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMergeJSON(out[k], v);
  return out;
}

// ---- per-preset build ------------------------------------------------------

function buildPreset(presetName) {
  assertPresetName(presetName);
  if (!RELEASE_PRESETS.includes(presetName)) {
    throw new Error(`preset is not in release-presets.json: ${presetName}`);
  }

  const presetSrc = assertWithin(PACKAGES, resolve(PACKAGES, presetName));
  const coreSrc = join(PACKAGES, 'core');
  const finalDst = assertWithin(DIST, resolve(DIST, presetName));

  if (!existsSync(presetSrc)) {
    console.error(`✗ preset 不存在: ${presetSrc}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(coreSrc)) {
    console.error(`✗ core 不存在: ${coreSrc}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(DIST, { recursive: true });
  const tempParent = mkdtempSync(join(DIST, '.build-'));
  const dst = join(tempParent, presetName);

  try {
  console.log(`\n▶ 构建 ${presetName} → dist/${presetName}/`);
  mkdirSync(dst, { recursive: true });

  // 1. preset 自有资源（先拷，确保 preset 同名文件优先）
  let n = 0;
  for (const sub of ['agents', 'skills', 'templates', 'commands', 'docs']) {
    n += copyDir(join(presetSrc, sub), join(dst, sub));
  }
  console.log(`  preset 自有资源: ${n} 个文件`);

  // preset 的 i18n/<locale>/
  if (existsSync(join(presetSrc, 'i18n'))) {
    n = copyDir(join(presetSrc, 'i18n'), join(dst, 'i18n'));
    console.log(`  preset i18n: ${n} 个文件`);
  }

  // preset.yml
  if (existsSync(join(presetSrc, 'preset.yml'))) {
    copyFileSync(join(presetSrc, 'preset.yml'), join(dst, 'preset.yml'));
    console.log(`  preset.yml ✓`);
  }

  // README
  if (existsSync(join(presetSrc, 'README.md'))) {
    copyFileSync(join(presetSrc, 'README.md'), join(dst, 'README.md'));
  }

  // 2. core/commands → dst/commands/（preset 同名优先，跳过已存在）
  n = copyDir(join(coreSrc, 'commands'), join(dst, 'commands'), { skipExisting: true });
  if (presetName !== 'preset-standard') {
    for (const fileName of LEAN_ONLY_CORE_COMMANDS) {
      safeRemoveWithin(dst, join(dst, 'commands', fileName));
    }
  }
  console.log(`  core 共享 commands: 新增 ${n} 个`);

  // 3. core/hooks → dst/hooks/（hooks.json 由 preset 提供，这里只补 .mjs）
  n = copyDir(join(coreSrc, 'hooks'), join(dst, 'hooks'), { skipExisting: true });
  console.log(`  core hooks: 新增 ${n} 个`);

  // preset 的 hooks/hooks.json（如果有，覆盖 core 的）
  if (existsSync(join(presetSrc, 'hooks', 'hooks.json'))) {
    copyFileSync(join(presetSrc, 'hooks', 'hooks.json'), join(dst, 'hooks', 'hooks.json'));
    console.log(`  preset hooks.json ✓`);
  }

  // 4. core/lib → dst/lib/
  n = copyDir(join(coreSrc, 'lib'), join(dst, 'lib'));
  console.log(`  core lib: ${n} 个文件`);

  // 5. core/schemas → dst/schemas/
  n = copyDir(join(coreSrc, 'schemas'), join(dst, 'schemas'));
  console.log(`  core schemas: ${n} 个文件`);

  // 5b. core/rules → dst/rules/
  n = copyDir(join(coreSrc, 'rules'), join(dst, 'rules'));
  if (n > 0) console.log(`  core rules: ${n} 个文件`);

  // 6. core/i18n → dst/i18n/（不覆盖 preset 已有的）
  n = copyDir(join(coreSrc, 'i18n'), join(dst, 'i18n'), { skipExisting: true });
  console.log(`  core i18n: 新增 ${n} 个`);

  // 7a. Claude Code plugin.json
  const presetPluginPath = join(presetSrc, '.claude-plugin', 'plugin.json');
  if (existsSync(presetPluginPath)) {
    assertRegularFile(presetPluginPath);
    const presetPlugin = JSON.parse(readFileSync(presetPluginPath, 'utf-8'));
    presetPlugin.version = VERSION;
    mkdirSync(join(dst, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(dst, '.claude-plugin', 'plugin.json'),
      JSON.stringify(presetPlugin, null, 2) + '\n',
      'utf-8',
    );
    console.log(`  plugin.json ✓ (version: ${VERSION})`);
  } else {
    console.warn(`  ⚠ ${presetName} 缺少 .claude-plugin/plugin.json`);
  }

  // 7b. Codex plugin.json
  const presetCodexPluginPath = join(presetSrc, '.codex-plugin', 'plugin.json');
  if (existsSync(presetCodexPluginPath)) {
    assertRegularFile(presetCodexPluginPath);
    const presetCodexPlugin = JSON.parse(readFileSync(presetCodexPluginPath, 'utf-8'));
    presetCodexPlugin.version = VERSION;
    mkdirSync(join(dst, '.codex-plugin'), { recursive: true });
    writeFileSync(
      join(dst, '.codex-plugin', 'plugin.json'),
      JSON.stringify(presetCodexPlugin, null, 2) + '\n',
      'utf-8',
    );
    console.log(`  codex plugin.json ✓ (version: ${VERSION})`);
  } else {
    console.warn(`  ⚠ ${presetName} 缺少 .codex-plugin/plugin.json`);
  }

  // 8. Codex command mirror skills（写入 codex-skills/）。
  //    这样 Codex 专用 mirror skills 不会污染 Claude Code 原本读取的 skills/ 目录。
  n = generateCodexSkills(dst);
  console.log(`  codex command mirror skills: ${n} 个`);

  // 9. 路径 rewrite（commands / hooks / lib / generated skills 里都可能有引用）
  const touched = rewriteAllTextFiles(dst);
  console.log(`  路径 rewrite: ${touched} 个文件`);

  safeRemoveWithin(DIST, finalDst);
  renameSync(dst, finalDst);

  console.log(`✓ ${presetName} 构建完成: dist/${presetName}/`);
  } finally {
    if (existsSync(tempParent)) safeRemoveWithin(DIST, tempParent);
  }
}

function assertRegularFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`expected regular file without symlink: ${path}`);
  }
}

function readReleasePresets() {
  const path = join(ROOT, 'release-presets.json');
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(config.presets) || config.presets.length === 0) {
    throw new Error('release-presets.json must declare a non-empty presets array');
  }
  const unique = [...new Set(config.presets.map(assertPresetName))].sort();
  if (unique.length !== config.presets.length) {
    throw new Error('release-presets.json contains duplicate presets');
  }
  for (const preset of unique) {
    const path = assertWithin(PACKAGES, resolve(PACKAGES, preset));
    if (!existsSync(path) || !lstatSync(path).isDirectory()) {
      throw new Error(`released preset directory is missing: ${preset}`);
    }
  }
  return unique;
}

// ---- root marketplace.json -------------------------------------------------
//
// 输出位置：<repo-root>/.claude-plugin/marketplace.json（进 git）
// 这是 CC `/plugin marketplace add <user>/cc-nexs` 唯一识别的位置。
// source 字段相对仓库根：`./dist/preset-<name>` —— dist/ 同样进 git，作为 plugin 内容载体。

function buildClaudeMarketplace(presetNames) {
  const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
  mkdirSync(dirname(marketplacePath), { recursive: true });

  const plugins = [];
  for (const name of presetNames) {
    const pluginJsonPath = join(DIST, name, '.claude-plugin', 'plugin.json');
    if (!existsSync(pluginJsonPath)) continue;
    const p = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    plugins.push({
      name: p.name,
      description: p.description,
      version: p.version,
      author: p.author || { name: 'cc-nexs' },
      source: `./dist/${name}`,
    });
  }

  const marketplace = {
    name: 'cc-nexs',
    owner: { name: 'cc-nexs' },
    metadata: {
      description: 'cc-nexs: Lean 默认的低 Token 多代理流水线，包含计划/发布双门禁、本地验证与一次集中 Review。',
      version: VERSION,
    },
    plugins,
  };

  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ .claude-plugin/marketplace.json (${plugins.length} 个 plugin)`);
}

function buildCodexMarketplace(presetNames) {
  const marketplacePath = join(ROOT, '.agents', 'plugins', 'marketplace.json');
  mkdirSync(dirname(marketplacePath), { recursive: true });

  const plugins = [];
  for (const name of presetNames) {
    const pluginJsonPath = join(DIST, name, '.codex-plugin', 'plugin.json');
    if (!existsSync(pluginJsonPath)) continue;
    const p = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    plugins.push({
      name: p.name,
      source: {
        source: 'local',
        path: `./dist/${name}`,
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: p.interface?.category || 'Engineering',
    });
  }

  const marketplace = {
    name: 'cc-nexs',
    interface: {
      displayName: 'cc-nexs',
    },
    plugins,
  };

  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n', 'utf-8');
  console.log(`✓ .agents/plugins/marketplace.json (${plugins.length} 个 plugin)`);
}

// ---- main ------------------------------------------------------------------

const arg = process.argv[2];
const allPresets = RELEASE_PRESETS;
const targets = arg ? [assertPresetName(arg)] : allPresets;
for (const target of targets) {
  if (!allPresets.includes(target)) {
    throw new Error(`preset is not in release-presets.json: ${target}`);
  }
}

console.log(`cc-nexs build`);
console.log(`  version: ${VERSION}`);
console.log(`  targets: ${targets.join(', ')}`);

for (const t of targets) buildPreset(t);
if (targets.includes('preset-standard')) generatePiResources();
// 总是基于全量 preset 列表刷新 marketplace.json，保证根目录入口与 dist/ 中产物一致。
buildClaudeMarketplace(allPresets);
buildCodexMarketplace(allPresets);

console.log(`\n✓ build done`);
