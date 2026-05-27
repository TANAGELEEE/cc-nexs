#!/usr/bin/env node
// cc-nexs build: 把 monorepo 源码物化成扁平 plugin。
// 输入：packages/core/* + packages/preset-<name>/*
// 输出：dist/<preset-name>/  ← 自包含 Claude Code Plugin
//
// 物化策略:
//   1. preset 自有资源直接拷（commands / agents / skills / templates / preset.yml）
//   2. core/commands 拷进 dist/commands（preset 同名命令优先，不被覆盖）
//   3. core/hooks 拷进 dist/hooks/（preset 的 hooks/hooks.json 和它们一起）
//   4. core/lib 拷进 dist/lib（commands 文本里引用的 "core/lib/X.mjs" → "lib/X.mjs"）
//   5. core/schemas 拷进 dist/schemas
//   6. core/i18n + preset/i18n（如有）merge 进 dist/i18n
//   7. plugin.json 从 preset 拷，version 同步根 package.json
//   8. 所有文本类文件做路径 rewrite：
//        "core/lib/"   → "lib/"
//        "_core/"      → ""        (例如 "_core/hooks/x.mjs" → "hooks/x.mjs")
//        "../core/"    → ""        (例如 "../core/commands/run.md" → "commands/run.md")
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
  for (const sub of ['agents', 'skills', 'templates', 'commands']) {
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

  // 7. plugin.json
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

  // 8. 路径 rewrite（commands / hooks / lib 里都可能有引用）
  const touched = rewriteAllTextFiles(dst);
  console.log(`  路径 rewrite: ${touched} 个文件`);

  console.log(`✓ ${presetName} 构建完成: dist/${presetName}/`);
}

// ---- root marketplace.json -------------------------------------------------
//
// 输出位置：<repo-root>/.claude-plugin/marketplace.json（进 git）
// 这是 CC `/plugin marketplace add <user>/cc-nexs` 唯一识别的位置。
// source 字段相对仓库根：`./dist/preset-<name>` —— dist/ 同样进 git，作为 plugin 内容载体。

function buildMarketplace(presetNames) {
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
buildMarketplace(allPresets);

console.log(`\n✓ build done`);
