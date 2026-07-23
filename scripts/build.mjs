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
//      保证 /cc-nexs:* 的 full / fast / hotfix SOP 仍以同一份 command 文档为事实来源。
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
const PI_P2_COMMANDS = new Set([
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
]);
const PI_ROLE_SOURCES = {
  'repo-scout': 'repo-scout-claude.md',
  fullstack: 'fullstack-claude.md',
  reviewer: 'reviewer-codex.md',
  verifier: 'verifier-codex.md',
};
const PI_ROLE_ADDENDA = {
  fullstack: `# Pi Hotfix Override

When the parent task explicitly declares a cc-nexs hotfix phase, this section supersedes the fast-only statements in the role contract below. Do not reject the task because the associated feature uses full mode.

- \`phase=hotfix-p3\`: make only a single-file, non-logic correction with a final diff of at most 20 lines. Do not create a BUG artifact.
- \`phase=hotfix-implement\`: create or update \`bugs/BUG-<N>.md\`, create an executable \`qa-scripts/BUG-<N>-repro.*\`, fix only the documented root cause, run the configured build/test commands, and move the BUG from \`OPEN\` to \`FIXED\` only after they pass.
- \`phase=hotfix-revise\`: address only the latest \`NEEDS_REVISION\` findings appended to the BUG file and keep the BUG at \`FIXED\` after local checks pass.
- \`phase=hotfix-regression\`: run the BUG repro and the affected module's existing P0 checks, append exact evidence to the BUG \`## 回归\` section, and move \`FIXED\` to \`VERIFIED\` only when every required check passes.
- \`phase=hotfix-rollback\`: for an already deployed P0/P1 fix, append a concrete \`## 生产回滚步骤 - BUG-<N>\` section to \`deploy.md\`.

Never edit \`spec.md\`, acceptance/review/test-report artifacts, or progress state. Never mutate Git; return exact changed paths to the parent Git Custodian.
`,
  reviewer: `# Pi Hotfix Override

When the parent task explicitly declares a cc-nexs hotfix target, this section supersedes the fast-only target list below. Each target must run in a fresh Pi child session and must remain separate from implementation and verification.

- \`target=hotfix-code\`: read the injected diff and \`bugs/BUG-<N>.md\`, but never browse \`src/\`. Review root-cause coverage, side effects, related paths, and missing regression coverage. Append \`## Round N - YYYY-MM-DD - 结论\` to that BUG file and end with exactly \`结论: PASS\` or \`结论: NEEDS_REVISION\`.
- \`target=hotfix-accept\` (P0/P1 only): do not reuse the hotfix-code session. Read only the relevant AC subset, the VERIFIED BUG evidence, and the linked regression case. Append \`## 线上缺陷修复 - BUG-<N>\` with an AC scoring table to \`acceptance.md\`, ending with exactly \`验收结果: 通过\` or \`验收结果: 未通过\`.

Never edit code, tests, progress state, or Git. The parent supplies the diff and owns all transitions and candidate commits.
`,
  verifier: `# Pi Hotfix Override

When the parent task explicitly declares \`target=hotfix-regression-case\` for a P0/P1 hotfix, this section supersedes the fast-only mode list below.

Read only the relevant AC/API contract, \`bugs/BUG-<N>.md\`, and its executable repro asset. Append a regression case marked \`关联BUG: BUG-<N>\` to \`test-cases.md\`, run the repro as a black-box check, and append the exact result to the BUG's regression evidence. Never browse or edit source code, never perform the implementation fix, and never mutate progress state or Git.
`,
};

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
  if (!['approve-deploy', 'approve-spec'].includes(commandBase)) return '';
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

This skill is the Codex mirror for \`${commandName}\`. It exists so the Codex plugin can preserve the same command surface, workflow semantics, document write locations, and full / fast / hotfix behavior as the Claude Code plugin.

## Authoritative Command

Read and follow \`${relCommand}\` as the single source of truth for this command. Treat the user's original message after \`${commandName}\` as the command arguments.

${controlBlock}## Execution Contract

1. Preserve every document path declared by the command file. Do not relocate \`all-docs/doc/{id}.{slug}/\`, \`doc/{id}.{slug}/\`, \`bugs/\`, \`qa-scripts/\`, \`docs/solutions/\`, or any command-specific artifact.
2. Preserve the command's state-machine contract. If the command says a single-step command must not advance \`progress.md\`, do not advance it; if \`run\` is the orchestrator, let \`run\` own state transitions.
3. Preserve mode behavior exactly:
   - \`full\`: five-role SOP with Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, and sprint loop.
   - \`fast\`: three-role flow with Fullstack / Reviewer / Verifier, single sprint, stricter thresholds, and no TECH_LEAD_REVIEW fallback.
   - \`hotfix\`: bypass flow with P0/P1/P2/P3 grading, BUG document writes, and escalation back to full SOP when the hotfix boundary is exceeded.
4. In Codex, every role runs as an independent native subagent using the role prompt from \`../../agents/\`. Never invoke Claude Code, a Claude subagent tool, or a nested \`codex\` CLI process. Runtime adaptation overrides any Claude-specific shell snippet in the authoritative command.
5. Keep implementation and review in distinct native agent sessions. This provides independent-context review even when the active provider channel exposes only one model. Never pass a literal model id: inherit the current Codex session/channel so channel switches cannot make the plugin unavailable.
6. When a shell snippet references \`$CLAUDE_PLUGIN_ROOT\`, translate it to the installed Codex plugin root that contains this skill. In shell commands prefer \`PLUGIN_ROOT=<plugin-root>\` or \`CC_NEXS_PLUGIN_ROOT=<plugin-root>\` or substitute the absolute plugin root directly.
7. Before editing or creating files, inspect the relevant command, agent, template, and current feature directory. Follow existing repo patterns and keep unrelated files untouched.
8. Run the verification steps requested by the command. If a step cannot be run in the current Codex surface, record the exact limitation and preserve the command's expected stop/gate behavior.

## Document Write Map

These are fixed cc-nexs locations, not Codex-specific alternatives:

- Feature docs: \`all-docs/doc/{id}.{slug}/requirements.md\`, \`repo-context.md\`, \`spec.md\`, \`sa-review.md\`, \`dev-plan.md\`, \`api-doc.md\`, \`deploy.md\`, \`test-cases.md\`, \`sa-test-review.md\`, \`test-report.md\`, \`sa-code-review.md\`, \`acceptance.md\`, \`progress.md\`, and \`README.md\`.
- Bug docs: \`all-docs/doc/{id}.{slug}/bugs/BUG-*.md\`, plus hotfix or QA repro assets under \`all-docs/doc/{id}.{slug}/qa-scripts/\`.
- Compound learnings: \`docs/solutions/<topic>.md\` plus the command-specific feature summary when \`/cc-nexs:compound\` requests it.
- Document repo commits: when \`all-docs/\` is its own git repo, add only \`doc/{id}.{slug}/\` or the command-declared bug path and keep code-repo files out of that commit.

## Full / Fast / Hotfix Mode Locks

- \`full\`: preserve Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, sprint slicing, artifact completeness gate before Evaluator, single human gate after spec approval, and README sync around every state transition.
- \`fast\`: preserve Fullstack / Reviewer / Verifier roles, single sprint, stricter counters, merged Reviewer acceptance parsing, Verifier black-box testing, no SA test-case review, and no TECH_LEAD_REVIEW fallback.
- \`hotfix\`: preserve P0/P1/P2/P3 grading, P3 direct-fix boundary, P2 BUG file plus repro plus SA-light-review loop, P0/P1 Evaluator section plus regression case plus rollback section, and escalation to full SOP when hotfix boundaries are exceeded.

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
      'Your model is selected externally by pi-subagents settings; do not choose or persist a model ID.',
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
        ? '支持 preset-standard hotfix 旁路流程，并通过 pi-subagents 运行隔离角色。'
        : '支持 preset-standard fast 模式，并通过 pi-subagents 运行隔离角色。',
      extractDescription(commandText, commandName).replace(/codex CLI/gi, 'Pi subagent'),
    ].join(' ');
    const modelGuard = supportsHotfix
      ? 'Before the first Reviewer dispatch, confirm that `cc-nexs.reviewer` resolves to an authenticated model different from the implementation model. P0/P1 must also confirm `cc-nexs.verifier` before verification. Accept ordered `fallbackModels`; if a required mapping is absent, unavailable, or resolves to the implementation model, stop and explain how to configure it.'
      : 'Before the first review or verification dispatch, confirm that `cc-nexs.reviewer` and `cc-nexs.verifier` resolve to an authenticated model different from the implementation model. Accept ordered `fallbackModels`. If the mapping is absent, unavailable, or resolves to the implementation model, stop and explain how to configure it; independent context alone is not heterogeneous review.';
    const skillDir = join(skillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    const body = `---
name: ${skillName}
description: ${description}
---

# ${commandName} for Pi

Read and follow \`../../../dist/preset-standard/commands/${fileName}\` as the authoritative command. Treat the text after \`${commandName}\` as its arguments.

${controlBlock}## P2 Runtime Contract

1. Pi support is experimental and limited to \`preset-standard\` fast mode plus the \`/cc-nexs:hotfix\` bypass. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed \`pi-subagents\` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: \`cc-nexs.repo-scout\`
   - Fullstack: \`cc-nexs.fullstack\`
   - Reviewer: \`cc-nexs.reviewer\`
   - Verifier: \`cc-nexs.verifier\`
3. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested \`pi\` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
4. The Fullstack agent inherits the active Pi default unless the user configured an override. Reviewer and Verifier model selection belongs exclusively to Pi settings under \`subagents.agentOverrides\`; cc-nexs ships no fixed model IDs.
5. ${modelGuard}
6. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
7. Set or preserve \`CC_NEXS_RUNTIME=pi\` and \`CC_NEXS_PLUGIN_ROOT\` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
8. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.

${supportsHotfix ? `## Pi Hotfix Dispatch Contract

1. Hotfix is a bypass workflow, not a full/fast state-machine transition. Do not reject it solely because the associated feature's progress mode is \`full\`; do not advance \`progress.json\` or \`progress.md\`.
2. The parent classifies P0/P1/P2/P3 exactly as the authoritative command requires, honors an explicit \`--level\`, prints the classification and reason before mutation, and resolves the existing feature/worktree before dispatch.
3. P3: dispatch \`cc-nexs.fullstack\` once with \`phase=hotfix-p3\`. Re-check the single-file, at-most-20-line, non-logic boundary after the edit. If it is exceeded, reclassify before recording a candidate.
4. P2: dispatch \`cc-nexs.fullstack\` with \`phase=hotfix-implement\`; then dispatch \`cc-nexs.reviewer\` with \`target=hotfix-code\` and an injected diff. On \`NEEDS_REVISION\`, dispatch a fresh Fullstack \`phase=hotfix-revise\` and a fresh Reviewer, stopping after the third failed review and escalating to the full SOP. After \`PASS\`, dispatch a fresh Fullstack \`phase=hotfix-regression\`; only successful evidence may move the BUG to \`VERIFIED\`.
5. P0/P1: complete P2 first, then dispatch \`cc-nexs.verifier\` with \`target=hotfix-regression-case\`, followed by a fresh \`cc-nexs.reviewer\` with \`target=hotfix-accept\`. An unpassed acceptance result stops completion. If \`deploy.md\` says the change is already deployed, dispatch Fullstack \`phase=hotfix-rollback\` before recording candidates.
6. Before the first review or verification dispatch, confirm the package role resolves to an authenticated model different from the Fullstack implementation model. Reviewer and Verifier may use their configured fallback chains, but the public package never supplies a model ID.
7. Child roles never commit. After all required checks pass, the parent invokes the cc-nexs Git Custodian contract to record only declared code and docs candidate paths. Merge, push, and cleanup still require the normal explicit release authorization.
8. Preserve every escalation boundary: AC/spec changes, a diff over 500 lines, cross-module refactoring, or three failed review rounds must stop hotfix and direct the user to a new full workflow.
` : ''}

## Required Pi Prerequisite

\`pi-subagents\` must be installed and its \`subagent\` tool must expose the package agents above. Run \`/subagents-doctor\`, then open \`/subagents\` to inspect package-agent model mappings. \`/subagents-models\` is only for builtin agents and must not be used for cc-nexs package roles.
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
      description: 'cc-nexs: 多角色 + 状态机驱动的 SOP 流水线，spec 通过评审后唯一一次人工 checkpoint。',
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
