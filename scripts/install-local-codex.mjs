#!/usr/bin/env node
// Build and register the local cc-nexs Codex marketplace.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const MARKETPLACE = join(ROOT, '.agents', 'plugins', 'marketplace.json');
const CODEX_CONFIG = join(homedir(), '.codex', 'config.toml');
const CODEX_CACHE = join(homedir(), '.codex', 'plugins', 'cache', 'cc-nexs');
const PLUGINS = [
  { key: 'cc-nexs@cc-nexs', preset: 'preset-nexs' },
  { key: 'cc-nexs-minimal@cc-nexs', preset: 'preset-minimal' },
];

const SELECTED = resolveSelectedPlugins(process.argv.slice(2));

function run(command, options = {}) {
  return execSync(command, {
    cwd: ROOT,
    stdio: options.stdio || 'pipe',
    encoding: 'utf-8',
  });
}

console.log('cc-nexs install-local-codex');
console.log(`  root: ${ROOT}`);
console.log(`  enable: ${SELECTED.map((plugin) => plugin.key).join(', ')}`);

console.log('\n▶ Build Codex plugin artifacts...');
run('pnpm build', { stdio: 'inherit' });

console.log('\n▶ Validate plugin artifacts and SOP parity...');
run('pnpm validate:plugins', { stdio: 'inherit' });

console.log('\n▶ Copy plugins into Codex local cache...');
for (const plugin of PLUGINS) {
  const pluginRoot = join(ROOT, 'dist', plugin.preset);
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf-8'));
  const cachePath = join(CODEX_CACHE, manifest.name, manifest.version);
  rmSync(cachePath, { recursive: true, force: true });
  copyDirReal(pluginRoot, cachePath);
  console.log(`  ${manifest.name}@cc-nexs -> ${cachePath}`);
}

if (!existsSync(MARKETPLACE)) {
  console.error(`\n✗ missing Codex marketplace: ${MARKETPLACE}`);
  process.exit(1);
}

console.log('\n▶ Register local Codex marketplace...');
try {
  run(`codex plugin marketplace add ${JSON.stringify(ROOT)}`, { stdio: 'inherit' });
} catch (error) {
  const message = `${error.stdout || ''}\n${error.stderr || ''}`;
  if (/already|exists|duplicate/i.test(message)) {
    console.log('  marketplace already registered');
  } else {
    console.error('\n✗ codex plugin marketplace add failed');
    console.error(message.trim());
    console.error('\nManual fallback:');
    console.error(`  codex plugin marketplace add ${ROOT}`);
    process.exit(1);
  }
}

console.log('\n✓ Codex marketplace registered');
console.log('\n▶ Enable local cc-nexs plugins in Codex config...');
enablePluginsInConfig();
console.log(`  enabled: ${SELECTED.map((plugin) => plugin.key).join(', ')}`);

console.log('\nNext steps in Codex:');
console.log('  1. Restart Codex or open a new thread.');
console.log('  2. Open /plugins if you want to inspect the cc-nexs marketplace entry.');
console.log('  3. For local hook enforcement, review and trust cc-nexs hooks with /hooks.');

function enablePluginsInConfig() {
  mkdirSync(dirname(CODEX_CONFIG), { recursive: true });
  let text = existsSync(CODEX_CONFIG) ? readFileSync(CODEX_CONFIG, 'utf-8') : '';
  for (const pluginKey of PLUGINS) {
    const escaped = pluginKey.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRe = new RegExp(`(\\[plugins\\."${escaped}"\\]\\n)([^\\[]*)`, 'm');
    const enabled = SELECTED.some((selected) => selected.key === pluginKey.key);
    if (sectionRe.test(text)) {
      text = text.replace(sectionRe, (_match, header, body) => {
        if (/^enabled\s*=/m.test(body)) {
          return header + body.replace(/^enabled\s*=.*$/m, `enabled = ${enabled}`);
        }
        return `${header}enabled = ${enabled}\n${body}`;
      });
    } else {
      const separator = text.endsWith('\n') || text.length === 0 ? '' : '\n';
      text += `${separator}\n[plugins."${pluginKey.key}"]\nenabled = ${enabled}\n`;
    }
  }
  writeFileSync(CODEX_CONFIG, text, 'utf-8');
}

function resolveSelectedPlugins(args) {
  if (args.includes('--all')) return PLUGINS;
  const requested = args.find((arg) => !arg.startsWith('-')) || 'preset-nexs';
  const plugin = PLUGINS.find((candidate) => candidate.preset === requested || candidate.key.startsWith(`${requested}@`));
  if (!plugin) {
    console.error(`Unknown preset/plugin: ${requested}`);
    console.error(`Allowed: ${PLUGINS.map((candidate) => candidate.preset).join(', ')}, --all`);
    process.exit(1);
  }
  return [plugin];
}

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
  }
}
