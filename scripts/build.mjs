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
//   node scripts/build.mjs preset-nexs     # 仅构建一个

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PACKAGES = join(ROOT, 'packages');
const DIST = join(ROOT, 'dist');

const ROOT_PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = ROOT_PKG.version;

// ---- helpers ---------------------------------------------------------------

function copyDir(src, dst, { skipExisting = false } = {}) {
  if (!existsSync(src)) return 0;
  mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      n += copyDir(s, d, { skipExisting });
    } else if (st.isFile()) {
      if (skipExisting && existsSync(d)) continue;
      copyFileSync(s, d);
      n += 1;
    }
  }
  return n;
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
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
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

function generateCodexSkills(dst) {
  const commandsDir = join(dst, 'commands');
  const codexSkillsDir = join(dst, 'codex-skills');
  rmSync(codexSkillsDir, { recursive: true, force: true });
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
    const body = `---
name: ${skillName}
description: ${description}
---

# ${commandName} for Codex

This skill is the Codex mirror for \`${commandName}\`. It exists so the Codex plugin can preserve the same command surface, workflow semantics, document write locations, and full / fast / hotfix behavior as the Claude Code plugin.

## Authoritative Command

Read and follow \`${relCommand}\` as the single source of truth for this command. Treat the user's original message after \`${commandName}\` as the command arguments.

## Execution Contract

1. Preserve every document path declared by the command file. Do not relocate \`all-docs/doc/{id}.{slug}/\`, \`doc/{id}.{slug}/\`, \`bugs/\`, \`qa-scripts/\`, \`docs/solutions/\`, or any command-specific artifact.
2. Preserve the command's state-machine contract. If the command says a single-step command must not advance \`progress.md\`, do not advance it; if \`run\` is the orchestrator, let \`run\` own state transitions.
3. Preserve mode behavior exactly:
   - \`full\`: five-role SOP with Repo Scout pre-spec recon, Planner / Tech Lead / SA / QA / Evaluator isolation, and sprint loop.
   - \`fast\`: three-role flow with Fullstack / Reviewer / Verifier, single sprint, stricter thresholds, and no TECH_LEAD_REVIEW fallback.
   - \`hotfix\`: bypass flow with P0/P1/P2/P3 grading, BUG document writes, and escalation back to full SOP when the hotfix boundary is exceeded.
4. When the command references a Claude Code \`Task\` tool or \`claude-subagent\`, reproduce the role boundary inside Codex by using the role's agent prompt from \`../../agents/\`, setting the equivalent \`CC_NEXS_ROLE\` discipline in your own execution, and returning only the role's expected artifact.
5. When the command references a Codex CLI reviewer role, keep it as a separate Codex role invocation or separate reasoning pass. Do not merge QA / Evaluator / Reviewer outputs unless the fast-mode command explicitly says that role is merged.
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

function deepMergeJSON(a, b) {
  if (b == null) return a;
  if (typeof b !== 'object' || Array.isArray(b)) return b;
  const out = Array.isArray(a) ? [...a] : { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMergeJSON(out[k], v);
  return out;
}

// ---- per-preset build ------------------------------------------------------

function buildPreset(presetName) {
  const presetSrc = join(PACKAGES, presetName);
  const coreSrc = join(PACKAGES, 'core');
  const dst = join(DIST, presetName);

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

  console.log(`\n▶ 构建 ${presetName} → dist/${presetName}/`);

  rmSync(dst, { recursive: true, force: true });
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

  // 6. core/i18n → dst/i18n/（不覆盖 preset 已有的）
  n = copyDir(join(coreSrc, 'i18n'), join(dst, 'i18n'), { skipExisting: true });
  console.log(`  core i18n: 新增 ${n} 个`);

  // 7a. Claude Code plugin.json
  const presetPluginPath = join(presetSrc, '.claude-plugin', 'plugin.json');
  if (existsSync(presetPluginPath)) {
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

  console.log(`✓ ${presetName} 构建完成: dist/${presetName}/`);
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
const allPresets = readdirSync(PACKAGES)
  .filter((d) => d.startsWith('preset-'))
  .filter((d) => statSync(join(PACKAGES, d)).isDirectory());

const targets = arg ? [arg] : allPresets;

console.log(`cc-nexs build`);
console.log(`  version: ${VERSION}`);
console.log(`  targets: ${targets.join(', ')}`);

for (const t of targets) buildPreset(t);
// 总是基于全量 preset 列表刷新 marketplace.json，保证根目录入口与 dist/ 中产物一致。
buildClaudeMarketplace(allPresets);
buildCodexMarketplace(allPresets);

console.log(`\n✓ build done`);
