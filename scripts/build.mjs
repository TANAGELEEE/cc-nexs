#!/usr/bin/env node
// cc-nexs build: 把 monorepo 源码物化成扁平 plugin。
// 输入：packages/core/* + packages/preset-<name>/*
// 输出：dist/<preset-name>/  ← 自包含 Claude Code + Codex Plugin
//      pi/agents + pi/skills ← preset-standard 的 Pi runtime adapters
//      根 marketplace       ← Claude Code + Codex 分发入口
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
//      command 文档始终是事实来源；mirror 只保留 runtime delta。
//  10. preset-standard 同源生成 Pi agents/skills；pi/extensions/cc-nexs.ts 仍是手写 runtime 入口。
//
// 用法:
//   node scripts/build.mjs                # 构建全部 preset
//   node scripts/build.mjs preset-standard     # 仅构建一个

import { execFileSync } from 'node:child_process';
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
import { extractFrontmatter, matchFrontmatter } from '../packages/core/lib/frontmatter.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PACKAGES = join(ROOT, 'packages');
const DIST = join(ROOT, 'dist');

const ROOT_PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = ROOT_PKG.version;
const RELEASE_PRESETS = readReleasePresets();
const PI_ROOT = join(ROOT, 'pi');
const GENERATED_PATHS = [
  'dist',
  'pi/agents',
  'pi/skills',
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
];
const LEAN_ONLY_CORE_COMMANDS = new Set([
  'approve-plan.md',
  'render-plan.md',
  'request-release-changes.md',
  'migrate-feature-config.md',
  'revise-hotfix.md',
]);
const PI_P2_COMMANDS = new Set([
  'approve-plan',
  'approve-release',
  'brainstorm',
  'build',
  'doctor',
  'git-custodian',
  'hotfix',
  'revise-hotfix',
  'init',
  'lean-review',
  'lean-verify',
  'migrate-feature-config',
  'sync-base',
  'switch-test-target',
  'release-test',
  'resolve-test-conflict',
  'release-base',
  'render-plan',
  'request-release-changes',
  'run',
  'status',
  'verify-local',
  'plan',
  'execute',
]);
const PI_ROLE_SOURCES = {
  'lean-planner': 'lean-planner.md',
  'lean-plan-reviewer': 'lean-plan-reviewer.md',
  'lean-developer': 'lean-developer.md',
  'lean-reviewer': 'lean-reviewer.md',
  'lean-verifier': 'lean-verifier.md',
  'hotfix-developer': 'hotfix-developer.md',
  'hotfix-reviewer': 'hotfix-reviewer.md',
  'hotfix-verifier': 'hotfix-verifier.md',
};
const PI_VERIFIER_ROLES = new Set(['lean-verifier', 'hotfix-verifier']);
const PI_COMPUTER_USE_TOOLS = [
  'find_roots',
  'observe_ui',
  'search_ui',
  'expand_ui',
  'inspect_ui',
  'act_ui',
  'read_text',
  'wait_for',
];

const PI_EGO_LITE_VERIFIER_ADDENDUM = `## Pi Ego Lite Browser Contract

- This agent is the preferred Pi browser verifier and MUST use ego lite exclusively through the \`ego-browser\` CLI and the selected \`ego-browser\` skill.
- Read the selected \`ego-browser\` skill before the first browser operation, then invoke \`ego-browser\` only through Bash as documented by that skill.
- Create or reuse one isolated ego task Space for the feature, release attempt, and environment revision. Reuse its signed-in browser state and close it with \`completeTaskSpace(..., { keep: false })\` only after verification is complete.
- Navigate only to the configured \`allowed_hosts\`, verify the resulting URL after every navigation, and do not bypass browser policy with direct HTTP, CDP, or injected browser automation.
- Never request or expose plaintext credentials. Browser capability is checked only after test merge/CI delivery has deployed the candidate. If ego lite is then unavailable before the first browser action, return a provider-unavailable result so the parent can select the dedicated headless computer-use verifier. If neither provider is usable, return \`manual_required\` for recoverable human verification; never roll back delivery or switch providers inside this child.
`;

const PI_COMPUTER_USE_VERIFIER_ADDENDUM = `## Pi Headless Computer Use Browser Contract

- This agent is the fallback Pi browser verifier. Use only the installed \`@injaneity/pi-computer-use@0.4.3\` extension tools and only after the parent has proved the effective extension configuration has \`browser_use: true\` and \`headless: true\`.
- Keep one provider for the complete release attempt. Never invoke ego lite from this child and never use raw pointer/keyboard delivery, foreground focus fallback, cursor takeover, or another foreground interaction path.
- Follow the immutable-state loop: find the exact browser root, observe it, query the saved state, act against the same \`stateId\`, and consume the successor state. Prefer semantic targets; do not guess coordinates when headless policy makes an action unavailable.
- Navigate only to configured \`allowed_hosts\`, verify the resulting URL and test-environment identity after navigation, and never target production.
- Reuse an existing authenticated browser session and never request or expose plaintext credentials. Missing tools, an interactive desktop session, browser/login state, MFA/CAPTCHA handling, or a headless-safe semantic action makes post-deployment verification \`manual_required\`. Preserve the deployed candidate and evidence so verification can resume; these limitations never block test merge/CI delivery.
`;
const EXPLICIT_AGENT_TRIGGER_PREFIX = 'Only dispatch after the user explicitly invokes a cc-nexs command or skill; never auto-trigger for ordinary natural-language requests.';

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

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, '\n');
}

function rewriteTextPaths(file) {
  if (!TEXT_EXTS.has(extname(file))) return false;
  let text = readFileSync(file, 'utf-8');
  const before = text;
  text = normalizeLineEndings(text)
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
  if (desc.startsWith('"')) return JSON.parse(desc);
  return desc.replace(/^["']|["']$/g, '');
}

function assertExplicitClaudeEntrypoints(dst) {
  const entryFiles = [];
  const commandsDir = join(dst, 'commands');
  if (existsSync(commandsDir)) {
    entryFiles.push(...readdirSync(commandsDir)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => join(commandsDir, entry)));
  }
  const skillsDir = join(dst, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir).sort()) {
      const skillPath = join(skillsDir, entry, 'SKILL.md');
      if (existsSync(skillPath)) entryFiles.push(skillPath);
    }
  }
  for (const file of entryFiles) {
    const text = readFileSync(file, 'utf8');
    const frontmatter = extractFrontmatter(text);
    if (!/^disable-model-invocation:\s*true\s*$/m.test(frontmatter)) {
      throw new Error(`explicit-only Claude entry is missing disable-model-invocation: true: ${file}`);
    }
  }
}

function scopePluginAgentsToExplicitInvocation(dst) {
  const agentsDir = join(dst, 'agents');
  if (!existsSync(agentsDir)) return 0;
  let touched = 0;
  for (const entry of readdirSync(agentsDir).filter((file) => file.endsWith('.md')).sort()) {
    const file = join(agentsDir, entry);
    const text = readFileSync(file, 'utf8');
    if (text.includes(EXPLICIT_AGENT_TRIGGER_PREFIX)) continue;
    const next = text.replace(/^description:\s*(.+)$/m, (_match, description) => {
      const normalized = description.trim().replace(/^["']|["']$/g, '');
      return `description: ${JSON.stringify(`${EXPLICIT_AGENT_TRIGGER_PREFIX} ${normalized}`)}`;
    });
    if (next === text) throw new Error(`Claude agent is missing frontmatter description: ${file}`);
    writeFileSync(file, next, 'utf8');
    touched += 1;
  }
  return touched;
}

function addModelGatewayContract(dst) {
  const commands = join(dst, 'commands');
  for (const name of readdirSync(commands).filter((file) => file.endsWith('.md'))) {
    const path = join(commands, name);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, `${text.trimEnd()}\n\n## Model dispatch preview\n\nBefore any role dispatch, follow \`<plugin-root>/rules/model-discovery.md\` and the shared \`modelGateway\` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.\n`);
  }
}

function deterministicControlBlock(commandBase, cliPath) {
  if (['hotfix', 'init-hotfix', 'revise-hotfix'].includes(commandBase)) {
    return `## Deterministic Hotfix Controls

Resolve \`${cliPath}\` relative to this SKILL.md. Follow the authoritative command for the applicable initialization, binding, or authorized revision action:

\`\`\`text
node <resolved-cli-path> init-hotfix <slug> --description "<bug description>" [--bug-key YYYYMMDD-slug] [--related <feature-id>] [--repos a,b] [--bug-file <docs-relative.md>]
node <resolved-cli-path> start-hotfix <bug-key-or-legacy-id> [--level P0|P1|P2|P3] [--related <feature-id>]
node <resolved-cli-path> revise-hotfix <bug-key-or-legacy-id> --reason "<reason>" --authorization-evidence "<existing user authorization>" [--promote-lean]
\`\`\`

New Hotfix tasks use \`hotfix/<key>\` and one assigned BUG document; never reserve a shared feature number or publish placeholders. Resolve the BUG through \`progress.hotfix_document\` and keep machine state in \`.cc-nexs/hotfixes/<key>/\`; legacy \`hotfix.md\` tasks remain resumable. Every severity, including P3, requires independent Review. Authorized revisions retain the key/branch and invalidate current evidence; Lean promotion still requires Gateway A.

Subsequent local verification, Review recording, test release/verification, release approval, and base integration must use the packaged controls named by the authoritative command. Only an explicitly authorized \`approve-release --test-exception\` may accept an actual deployed \`manual_required\` environment gap with exact local/Review and rollback evidence; it preserves the unverified fact and does not authorize production deployment. Never edit progress state or perform ad hoc merge/push operations.

`;
  }
  if (commandBase === 'release-test') {
    return `## Deterministic Test Release Control

Resolve \`${cliPath}\` relative to this SKILL.md and deliver the exact candidate to the test branch/CI first:

\`\`\`text
node <resolved-cli-path> release-test <feature-id> [--resume | --retry] [--dry-run] [--hotfix]
\`\`\`

Never implement test-branch integration with ad hoc Git commands and never target production. Browser tools, login/MFA state, and verification-page URL availability are post-deployment verification capabilities, not delivery preconditions. If they are unavailable after deployment, record the recoverable \`manual_required\` / \`deployed_needs_manual_verification\` state with evidence and stop without claiming verification passed; do not undo or block the completed test merge/CI delivery.

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
  if (commandBase === 'verify-local') {
    return `## Deterministic Lean/Hotfix Control — Local Verification

Resolve \`${cliPath}\` relative to this SKILL.md and preserve the user's original verification flags and every repeated evidence object:

\`\`\`text
node <resolved-cli-path> verify-local <feature-id> [--passed | --failed | --deferred-to-test] [--evidence-json <json>]... [--progress <path>]
\`\`\`

With a configured driver, omit direct evidence flags. Without a driver, execute Lean plan-approved or Hotfix scope-bound commands first, then pass their real structured results. Both paths require exact command/exit_code/proof evidence covering the frozen matrix. Hotfix accepts passed/failed only and never defers checks. Never invent evidence or replace this control with model-generated progress edits.

`;
  }
  if (['release-base', 'render-plan', 'migrate-feature-config'].includes(commandBase)) {
    const invocation = commandBase === 'migrate-feature-config'
      ? 'migrate-feature-config <feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]'
      : `${commandBase} <feature-id>`;
    return `## Deterministic Lean Control

Resolve \`${cliPath}\` relative to this SKILL.md and execute:

\`\`\`text
node <resolved-cli-path> ${invocation}
\`\`\`

Never replace this control with model-generated progress edits or ad hoc Git commands.

`;
  }
  if (!['approve-plan', 'approve-release'].includes(commandBase)) return '';
  const approvalArgs = commandBase === 'approve-release' ? ' [--test-exception --authorization-evidence <text> --reason <text> --environment-evidence <text> --rollback-evidence <text>]' : '';
  return `## Deterministic Approval Control

Resolve \`${cliPath}\` relative to this SKILL.md and execute the packaged control program:

\`\`\`text
node <resolved-cli-path> ${commandBase} <feature-id>${approvalArgs}
\`\`\`

Preserve the user's original approval flags and evidence. Never execute \`/cc-nexs:${commandBase}\` as a shell path and never edit \`progress.json\` or \`progress.md\` directly. An authorized test-environment exception retains the unverified test fact and permits configured base integration only, not production deployment. After the control program succeeds, continue the current runtime's run workflow.

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
    const commandText = normalizeLineEndings(readFileSync(commandPath, 'utf-8'));
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    if (!skillName) continue;

    const commandBase = basename(fileName, '.md');
    const description = [
      `${commandName} Codex mirror skill.`,
      `Use when $${skillName} is explicitly invoked.`,
      extractDescription(commandText, commandName),
    ].join(' ');
    const skillRoot = join(codexSkillsDir, skillName);
    mkdirSync(skillRoot, { recursive: true });
    mkdirSync(join(skillRoot, 'agents'), { recursive: true });
    const relCommand = `../../commands/${fileName}`;
    const controlBlock = deterministicControlBlock(commandBase, '../../lib/cc-nexs-cli.mjs');
    const body = `---
name: ${skillName}
description: ${JSON.stringify(description)}
---

# ${commandName} for Codex

This explicit-only skill is a thin Codex runtime adapter for \`${commandName}\`.

## Authoritative Command

Read and follow \`${relCommand}\` as the single source of truth for this command. Treat the user's original message after \`${commandName}\` as the command arguments.

${controlBlock}## Codex Runtime Delta

Before role dispatch, read \`../../rules/model-discovery.md\` and use \`modelGateway\` inspect/prepare/start/result. Reuse the current host's cached choices before discovery. Show the non-blocking preview on first use or changes; never wait for a reply. Use the current native spawn tool catalog when discovery is needed; retain explicit overrides.

- Dispatch every requested role as an independent native subagent using \`../../agents/\`; keep implementation, Review, and verification in fresh isolated sessions. Never invoke Claude Code, a Claude subagent tool, or a nested \`codex\` CLI process.
- ${supportsLean ? 'Resolve automatic risk routing once from progress/config/approved-plan: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. A Reviewer may use a different model or the same model with higher reasoning effort. ' : ''}Provider-specific IDs are allowed only in private project/feature config; public defaults remain portable.
- Translate \`$CLAUDE_PLUGIN_ROOT\` to this installed Codex plugin root and preserve the authoritative command's state transitions, gates, counters, validation, and stop behavior.
- Browser tooling, login/MFA state, and verification-page URL availability are checked only after the exact candidate reaches test and CI delivery completes. They never block delivery. If post-deployment verification cannot run, record \`manual_required\` / \`deployed_needs_manual_verification\` with evidence and leave it recoverable; never claim a pass.

## Document Write Map

Preserve exactly the paths declared by the authoritative command: ordinary features use \`all-docs/doc/{id}.{slug}/\` and \`progress.md\`; new Hotfix tasks use the BUG identified by \`progress.hotfix_document\` with machine state in workspace \`.cc-nexs/hotfixes/<key>/\`. A related BUG uses \`doc/<id>.<slug>/bugs/BUG-<key>.md\`; otherwise use docs \`hotfix/<key>/BUG-001.md\`. Keep legacy \`hotfix.md\`, command-declared \`bugs/\`, and \`docs/solutions/\` compatible. Hotfix does not reserve a feature number or publish placeholders. Pass \`CC_NEXS_PROGRESS_FILE\` and the resolved \`BUG_FILE\` to Hotfix children; never infer the BUG from a private-state directory. Do not invent Codex-specific alternatives.

## Lean / Hotfix Mode Locks

The authoritative command alone defines \`${supportsLean ? 'lean and ' : ''}hotfix\` semantics. This adapter changes only Codex dispatch and runtime mechanics; it must not restate, reorder, or weaken a mode.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by \`${relCommand}\` are present in the original cc-nexs locations.
`;

    writeFileSync(join(skillRoot, 'SKILL.md'), body, 'utf-8');
    const agentMetadata = [
      'interface:',
      `  display_name: ${JSON.stringify(commandName)}`,
      `  short_description: ${JSON.stringify(`Run ${commandName} explicitly`)}`,
      `  default_prompt: ${JSON.stringify(`Use $${skillName} to run ${commandName}.`)}`,
      'policy:',
      '  allow_implicit_invocation: false',
      '',
    ].join('\n');
    writeFileSync(join(skillRoot, 'agents', 'openai.yaml'), agentMetadata, 'utf-8');
    generated += 1;
  }
  return generated;
}

function parseAgentSource(text, file) {
  text = normalizeLineEndings(text);
  const frontmatter = matchFrontmatter(text);
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
  const tintinDir = join(PI_ROOT, 'tintin-agents');
  safeRemoveWithin(ROOT, tintinDir);
  mkdirSync(tintinDir, { recursive: true });
  safeRemoveWithin(ROOT, agentsDir);
  safeRemoveWithin(ROOT, skillsDir);
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });

  for (const [role, sourceFile] of Object.entries(PI_ROLE_SOURCES)) {
    const sourcePath = join(standardSource, 'agents', sourceFile);
    const { description, tools, body } = parseAgentSource(readFileSync(sourcePath, 'utf8'), sourceFile);
    const roleBody = body;
    const variants = [{
      name: role,
      tools,
      addendum: PI_VERIFIER_ROLES.has(role) ? PI_EGO_LITE_VERIFIER_ADDENDUM : '',
      skills: PI_VERIFIER_ROLES.has(role) ? ['ego-browser'] : [],
      descriptionSuffix: PI_VERIFIER_ROLES.has(role) ? ' Preferred ego lite provider.' : '',
    }];
    if (PI_VERIFIER_ROLES.has(role)) {
      variants.push({
        name: `${role}-computer-use`,
        tools: [...new Set([...tools, ...PI_COMPUTER_USE_TOOLS])],
        addendum: PI_COMPUTER_USE_VERIFIER_ADDENDUM,
        skills: [],
        descriptionSuffix: ' Headless pi-computer-use fallback provider.',
      });
    }

    for (const variant of variants) {
      const header = [
        '---',
        `name: ${variant.name}`,
        'package: cc-nexs',
        `description: ${JSON.stringify(`${EXPLICIT_AGENT_TRIGGER_PREFIX} ${description.replace(/codex CLI/gi, 'Pi subagent').replace(/Claude/gi, 'Pi')}${variant.descriptionSuffix}`)}`,
        `tools: ${variant.tools.join(', ')}`,
        'defaultContext: fresh',
        'systemPromptMode: replace',
        'inheritProjectContext: true',
        'inheritSkills: false',
        ...(variant.skills.length ? [`skills: ${variant.skills.join(', ')}`] : []),
        '---',
        '',
        '# Pi Runtime Override',
        '',
        'You are already running as an isolated cc-nexs Pi child agent. Execute this role directly.',
        'Any Claude Task-tool, Claude subagent, Codex CLI, or nested agent invocation shown below is legacy runtime syntax only.',
        'Never invoke `claude`, `codex`, another `pi` process, `/cc-nexs:*`, or the `subagent` tool from this child.',
        'The parent orchestrator owns progress transitions and Git Custodian operations. Do not run Git mutation commands.',
        'The parent resolves the cc-nexs role profile and passes model/thinking through the detected Pi adapter; do not choose or persist a model ID.',
        '',
        variant.addendum,
        '# Authoritative Role Contract',
        '',
      ].join('\n');
      writeFileSync(join(agentsDir, `${variant.name}.md`), `${header}${roleBody}`, 'utf8');
      const tintinHeader = header
        .replace(`name: ${variant.name}`, `name: cc-nexs.${variant.name}`)
        .replace('defaultContext: fresh', 'inherit_context: false')
        .replace('systemPromptMode: replace', 'prompt_mode: replace')
        .replace('inheritProjectContext: true', 'extensions: true\ndisallowed_tools: Agent, subagent, cc_nexs_dispatch, cc_nexs_models, cc_nexs_model_gateway')
        .replace('inheritSkills: false', 'inherit_skills: false')
        .replace(`tools: ${variant.tools.join(', ')}`, `tools: ${variant.tools.map((tool) => ['read', 'write', 'edit', 'bash', 'find', 'grep', 'ls'].includes(tool) ? tool : `ext:${tool}`).join(', ')}`);
      writeFileSync(join(tintinDir, `cc-nexs.${variant.name}.md`), `${tintinHeader}${roleBody}`, 'utf8');
    }
  }

  const commandsDir = join(standardDist, 'commands');
  let generated = 0;
  for (const fileName of readdirSync(commandsDir).filter((entry) => entry.endsWith('.md')).sort()) {
    const commandBase = basename(fileName, '.md');
    if (!PI_P2_COMMANDS.has(commandBase)) continue;
    const commandText = readFileSync(join(commandsDir, fileName), 'utf8');
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    const supportsHotfix = ['hotfix', 'init-hotfix', 'revise-hotfix'].includes(commandBase);
    const controlBlock = deterministicControlBlock(commandBase, '../../../packages/core/lib/cc-nexs-cli.mjs');
    const description = [
      `${commandName} Pi P2 adapter skill.`,
      `Invoke only through /cc-nexs:${commandBase} or /skill:${skillName}; never auto-trigger from ordinary natural-language requests.`,
      supportsHotfix
        ? 'Supports the preset-standard standalone Hotfix branch and BUG document without consuming a requirement number, with isolated roles through pi-subagents.'
        : 'Supports preset-standard lean (default) and standalone hotfix modes with isolated roles through pi-subagents.',
      extractDescription(commandText, commandName).replace(/codex CLI/gi, 'Pi subagent'),
    ].join(' ');
    const modelGuard = supportsHotfix
      ? 'Resolve one Hotfix model snapshot: P0/P1 automatically routes Reviewer to escalated; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking in a fresh child. Use the detected Pi adapter for thinking; public files ship no provider-specific model IDs.'
      : 'Resolve automatic risk routing once: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking. Use the detected Pi adapter for thinking; public files ship no provider-specific model IDs.';
    const skillDir = join(skillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    const body = `---
name: ${skillName}
description: ${JSON.stringify(description)}
disable-model-invocation: true
---

# ${commandName} for Pi

Read and follow \`../../../dist/preset-standard/commands/${fileName}\` as the authoritative command. Treat the text after \`${commandName}\` as its arguments.

${controlBlock}## P2 Runtime Contract

Before role dispatch, read \`../../../dist/preset-standard/rules/model-discovery.md\` and use \`cc_nexs_model_gateway\` inspect/prepare/start/result. Call \`cc_nexs_models\` only for missing or invalidated catalogs. Show the non-blocking preview on first use or changes; never wait for a reply. Retain explicit overrides.

1. Pi supports \`preset-standard\` lean (default) and standalone hotfix; unsupported compound flows fail closed rather than downgrade.
2. Call \`cc_nexs_dispatch({})\` once to detect the installed API. Dispatch a bounded wave using \`cc_nexs_dispatch({ tasks: [{ agent: "cc-nexs.lean-developer", task: "<assignment>", cwd: "<assigned absolute worktree>", model: "<frozen provider/model>", effort: "<frozen thinking>" }], concurrency: 1 })\`. Start every sibling before waiting; never create child worktrees or nested children.

The adapter preserves both APIs:
- \`pi-subagents@0.35.1\`: one \`subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })\`, then \`subagent_wait({ id })\`.
- \`@tintinweb/pi-subagents@0.14.3\`: RPC v2 spawn for each sibling, separate model/thinking fields and actual assigned cwd. The public \`Agent\` tool has no cwd field; do not substitute it or ask the child to cd. Use installed \`cc-nexs.*\` role files. Await completion notifications for every returned ID, then collect \`get_subagent_result\`; no polling or sleeping. The adapter reports partial start failures without discarding already-started IDs.

3. Test merge/CI delivery runs before browser capability selection. Only after deployment, prefer ego lite; otherwise use \`@injaneity/pi-computer-use@0.4.3\` when effective config has \`browser_use: true\` and \`headless: true\`. Missing browser/login/MFA/verification URL capability records recoverable \`manual_required\` evidence and never blocks or rolls back delivery.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested \`pi\` CLI. Runtime adaptation changes dispatch only; preserve the authoritative command's paths, state transitions, gates, counters, validation, and stop behavior.
5. ${modelGuard}
6. The adapter encodes thinking as \`provider/model:thinking\` only for the tasks API; RPC v2 uses \`thinkingLevel\`. Omit inherited values. After all children finish, retry ordered \`fallback_models\` only for failed/unavailable tasks; never rerun successful siblings. Record gateway success only after real successful completion, never after spawn acceptance.
7. Role children never mutate Git or \`progress.md\` / \`progress.json\`. The parent owns state transitions and Git Custodian operations, and preserves \`CC_NEXS_RUNTIME=pi\` plus \`CC_NEXS_PLUGIN_ROOT\`. For Hotfix children, also pass \`CC_NEXS_PROGRESS_FILE\` and the resolved \`BUG_FILE\`; machine-state directories do not determine document paths.

${supportsHotfix ? `## Pi Hotfix Dispatch Contract

1. Initialize \`mode=hotfix\` with \`init-hotfix\`: create \`hotfix/<key>\` and the assigned BUG without a shared feature number or placeholder push. Resolve the BUG through \`progress.hotfix_document\`; machine state stays in \`.cc-nexs/hotfixes/<key>/\`. Legacy \`hotfix.md\` tasks remain resumable.
2. Bind intended paths, required P0/P1 rollback fields, and actual local verification commands before dispatch. Use fresh \`cc-nexs.hotfix-developer\`, \`cc-nexs.hotfix-reviewer\`, and post-deployment \`cc-nexs.hotfix-verifier\` (or \`cc-nexs.hotfix-verifier-computer-use\`) sessions. Every severity, including P3, requires independent Review; file/line counts do not prove behavior.
3. Preserve the existing delta Review limit across Review, test, and Gateway B feedback. Use \`revise-hotfix\` for an already-authorized same-fault revision, retaining key/branch and history while invalidating current evidence. Contract expansion uses \`--promote-lean\` beside the original BUG and returns to Gateway A without reserving another number.
4. Missing post-deployment verification capability becomes recoverable \`manual_required\`. Only explicit user authorization through \`approve-release --test-exception\` may accept that real deployed environment gap with passed exact local/Review evidence and rollback proof. Preserve the test gap; the exception does not authorize production deployment. Never merge test into base or force push.
` : ''}

## Required Pi Prerequisites

Install either supported subagent package, then run the local installer and reload Pi. \`cc_nexs_dispatch({})\` checks the actual tool surface and RPC protocol. The installer supplies translated \`cc-nexs.*\` agent files for Tintin; it does not replace unrelated custom agents. Legacy tasks users can inspect \`/subagents-doctor\` and \`/subagents\`.

After test delivery, automatic verification prefers an onboarded ego lite app plus the \`ego-browser\` skill and a minimal \`ego-browser nodejs\` probe. Otherwise it may use \`@injaneity/pi-computer-use@0.4.3\` with effective \`browser_use: true\` and \`headless: true\`. If neither provider or signed-in session is ready, preserve the deployment, record \`manual_required\`, and resume manual verification later; do not silently claim a pass.
`;
    writeFileSync(join(skillDir, 'SKILL.md'), body, 'utf8');
    generated += 1;
  }

  console.log(`\n✓ Pi P2 resources: ${Object.keys(PI_ROLE_SOURCES).length + PI_VERIFIER_ROLES.size} agents, ${generated} skills`);
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
  assertExplicitClaudeEntrypoints(dst);
  addModelGatewayContract(dst);
  const scopedAgents = scopePluginAgentsToExplicitInvocation(dst);
  console.log(`  explicit-only Claude agents: ${scopedAgents} 个`);

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
      description: 'cc-nexs: Lean fast-track 多代理流水线，本地可执行验证后优先交付 test/CI，部署后验收并集中 Review。',
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
        path: `./dist/codex/${name}`,
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

function buildCodexDistribution(name) {
  const target = join(DIST, 'codex', name);
  safeRemoveWithin(DIST, target);
  copyTreeNoSymlinks(join(DIST, name), target);
  // Codex migrates commands/ automatically; ship only our native skill adapters.
  renameSync(join(target, 'commands'), join(target, 'command-docs'));
  safeRemoveWithin(target, join(target, '.claude-plugin'));
  function rewrite(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) rewrite(path);
      else if (entry.name.endsWith('.md')) {
        const text = readFileSync(path, 'utf8');
        writeFileSync(path, text.replaceAll('../../commands/', '../../command-docs/'));
      }
    }
  }
  rewrite(join(target, 'codex-skills'));
}

function assertGeneratedOutputsCleanInCi() {
  if (!['1', 'true'].includes(String(process.env.CI || '').toLowerCase())) return;
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...GENERATED_PATHS],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  if (!status) {
    console.log(`✓ CI generated-output dirty check: ${GENERATED_PATHS.join(', ')}`);
    return;
  }
  throw new Error(
    `[cc-nexs] build changed committed generated outputs:\n${status}\n`
    + `Run pnpm build and commit all of: ${GENERATED_PATHS.join(', ')}`,
  );
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
for (const t of targets) buildCodexDistribution(t);
if (targets.includes('preset-standard')) generatePiResources();
// 总是基于全量 preset 列表刷新 marketplace.json，保证根目录入口与 dist/ 中产物一致。
buildClaudeMarketplace(allPresets);
buildCodexMarketplace(allPresets);
assertGeneratedOutputsCleanInCi();

console.log(`\n✓ build done`);
