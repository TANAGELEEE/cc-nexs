#!/usr/bin/env node
// cc-nexs install-local: build → 拷到 ~/.claude/plugins/cache（真实目录，不软链）。
// 解决 Claude Code 在启动时清理"非标准"plugin 路径的问题——cache 必须是真实目录，
// CC 才会把它当作通过 /plugin install 流程产出的合法插件。
//
// 同时幂等地注册 cc-nexs marketplace：
//   - ~/.claude/plugins/marketplaces/cc-nexs 软链 → <repo-root>
//     （CC 校验 plugin@marketplace 时从这里读 .claude-plugin/marketplace.json）
//   - ~/.claude/plugins/known_marketplaces.json 写入条目
//   - ~/.claude/settings.json::enabledPlugins[<plugin>@cc-nexs] = true
//
// 用法：
//   node scripts/install-local.mjs                  # 默认 preset-nexs
//   node scripts/install-local.mjs preset-minimal   # 切换到 minimal preset

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  copyFileSync,
  rmSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PRESET = process.argv[2] || 'preset-nexs';

const DIST_PRESET = join(ROOT, 'dist', PRESET);
const ROOT_PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = ROOT_PKG.version;

// 从 preset 自身的 .claude-plugin/plugin.json 读 plugin name，避免硬编码映射。
const PRESET_PLUGIN_JSON = join(ROOT, 'packages', PRESET, '.claude-plugin', 'plugin.json');
if (!existsSync(PRESET_PLUGIN_JSON)) {
  console.error(`✗ 找不到 ${PRESET_PLUGIN_JSON}`);
  console.error(`  请确认 packages/${PRESET}/.claude-plugin/plugin.json 存在`);
  process.exit(1);
}
const PLUGIN_NAME = JSON.parse(readFileSync(PRESET_PLUGIN_JSON, 'utf-8')).name;
if (!PLUGIN_NAME) {
  console.error(`✗ ${PRESET_PLUGIN_JSON} 缺少 "name" 字段`);
  process.exit(1);
}

const MARKETPLACE_NAME = 'cc-nexs';
const CACHE_BASE = join(homedir(), '.claude', 'plugins', 'cache', MARKETPLACE_NAME);
const CACHE_PATH = join(CACHE_BASE, PLUGIN_NAME, VERSION);
const INSTALLED_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const MARKETPLACE_LINK = join(homedir(), '.claude', 'plugins', 'marketplaces', MARKETPLACE_NAME);
const KNOWN_MARKETPLACES = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
const INSTALLED = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
const SETTINGS = join(homedir(), '.claude', 'settings.json');

console.log(`cc-nexs install-local`);
console.log(`  preset:  ${PRESET}`);
console.log(`  plugin:  ${PLUGIN_NAME}`);
console.log(`  version: ${VERSION}`);
console.log(`  source:  ${DIST_PRESET}`);
console.log(`  target:  ${CACHE_PATH}`);

// 1. build
console.log(`\n▶ 跑 build...`);
execSync(`node ${join(ROOT, 'scripts', 'build.mjs')} ${PRESET}`, { stdio: 'inherit', cwd: ROOT });

if (!existsSync(DIST_PRESET)) {
  console.error(`\n✗ build 失败：${DIST_PRESET} 不存在`);
  process.exit(1);
}

const ROOT_MARKETPLACE_JSON = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(ROOT_MARKETPLACE_JSON)) {
  console.error(`\n✗ build 后未生成 ${ROOT_MARKETPLACE_JSON}`);
  process.exit(1);
}

// 2. 清空 cache 目标 + 真实复制
if (existsSync(CACHE_PATH)) {
  console.log(`\n▶ 清理旧 cache...`);
  rmSync(CACHE_PATH, { recursive: true, force: true });
}
console.log(`\n▶ 拷贝到 cache（真实目录）...`);
copyDirReal(DIST_PRESET, CACHE_PATH);
console.log(`  ${countFiles(CACHE_PATH)} 个文件已拷贝`);

// 3. 同步 installed_plugins.json
let installed = { version: 2, plugins: {} };
if (existsSync(INSTALLED)) {
  installed = JSON.parse(readFileSync(INSTALLED, 'utf-8'));
}
installed.plugins ||= {};
installed.plugins[INSTALLED_KEY] = [
  {
    scope: 'user',
    installPath: CACHE_PATH,
    version: VERSION,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  },
];
writeFileSync(INSTALLED, JSON.stringify(installed, null, 2) + '\n', 'utf-8');
console.log(`\n✓ 同步 installed_plugins.json`);

// 4. 注册 marketplace 软链（指向仓库根；marketplace.json 在 <root>/.claude-plugin/）
mkdirSync(dirname(MARKETPLACE_LINK), { recursive: true });
let needLink = true;
if (lstatSync(MARKETPLACE_LINK, { throwIfNoEntry: false })) {
  const st = lstatSync(MARKETPLACE_LINK);
  if (st.isSymbolicLink()) {
    const target = readlinkSync(MARKETPLACE_LINK);
    if (target === ROOT) {
      needLink = false;
    } else {
      console.log(`▶ 替换 marketplace 软链: ${target} → ${ROOT}`);
      unlinkSync(MARKETPLACE_LINK);
    }
  } else {
    console.log(`▶ 移除非软链占位 ${MARKETPLACE_LINK}`);
    rmSync(MARKETPLACE_LINK, { recursive: true, force: true });
  }
}
if (needLink) {
  symlinkSync(ROOT, MARKETPLACE_LINK);
  console.log(`✓ marketplace 软链 ${MARKETPLACE_LINK} → ${ROOT}`);
} else {
  console.log(`✓ marketplace 软链已是最新`);
}

// 5. known_marketplaces.json
let known = {};
if (existsSync(KNOWN_MARKETPLACES)) {
  known = JSON.parse(readFileSync(KNOWN_MARKETPLACES, 'utf-8'));
}
const desiredEntry = {
  source: { source: 'git', url: `file://${ROOT}` },
  installLocation: MARKETPLACE_LINK,
  lastUpdated: new Date().toISOString(),
};
const existingEntry = known[MARKETPLACE_NAME];
const sameSource = existingEntry?.source?.url === desiredEntry.source.url;
const sameLocation = existingEntry?.installLocation === desiredEntry.installLocation;
if (!existingEntry || !sameSource || !sameLocation) {
  known[MARKETPLACE_NAME] = desiredEntry;
  writeFileSync(KNOWN_MARKETPLACES, JSON.stringify(known, null, 2) + '\n', 'utf-8');
  console.log(`✓ 写入 known_marketplaces.json`);
} else {
  console.log(`✓ known_marketplaces.json 已是最新`);
}

// 6. settings.json::enabledPlugins
if (existsSync(SETTINGS)) {
  const settings = JSON.parse(readFileSync(SETTINGS, 'utf-8'));
  settings.enabledPlugins ||= {};
  if (settings.enabledPlugins[INSTALLED_KEY] !== true) {
    settings.enabledPlugins[INSTALLED_KEY] = true;
    writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    console.log(`✓ enabledPlugins[${INSTALLED_KEY}] = true`);
  } else {
    console.log(`✓ settings.json 已启用 ${INSTALLED_KEY}`);
  }
} else {
  console.log(`⚠️  ${SETTINGS} 不存在，跳过 enabledPlugins 写入`);
}

console.log(`\n✓ 安装完成`);
console.log(`\n👉 下一步：在 Claude Code 中跑 /reload-plugins（或重启）让 plugin 生效`);

// ---- helpers ---------------------------------------------------------------

function copyDirReal(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDirReal(s, d);
    } else if (st.isFile()) {
      copyFileSync(s, d);
    }
    // 跳过软链（避免把任何源码软链带进 cache）
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}
