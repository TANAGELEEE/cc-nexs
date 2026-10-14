#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { selectBuildCommands } from './build-selector.mjs';
import { loadConfig } from './config-loader.mjs';
import { configuredPluginRoot, findProjectConfigRoot } from './config-root.mjs';

export async function executeBuildPlan({
  cwd = process.cwd(),
  mergedStack,
  phase = 'both',
  dryRun = false,
  useCache = true,
  maxParallel = null,
  cacheRoot = null,
  runner = runShellCommand,
} = {}) {
  if (!['build', 'test', 'both'].includes(phase)) throw new Error('[cc-nexs] build phase must be build, test, or both');
  const selection = selectBuildCommands({ cwd, mergedStack });
  const concurrency = positiveInteger(maxParallel ?? mergedStack.build_max_parallel ?? 2, 'build max parallel');
  const cacheRequested = useCache && mergedStack.build_cache !== false;
  const fingerprint = cacheRequested ? candidateFingerprint(cwd, selection.diff_base) : null;
  const cacheEnabled = cacheRequested && Boolean(fingerprint);
  const cacheFile = cacheEnabled ? resolveCacheFile(cwd, cacheRoot) : null;
  const cache = cacheFile ? readCache(cacheFile) : { version: 1, successes: {} };
  const phases = phase === 'both' ? ['build', 'test'] : [phase];
  const results = [];

  for (const currentPhase of phases) {
    const jobs = dedupeJobs(selection.jobs, currentPhase);
    const phaseResults = await executeDag({
      jobs,
      cwd,
      phase: currentPhase,
      fingerprint,
      cache,
      cacheEnabled,
      dryRun,
      maxParallel: concurrency,
      runner,
    });
    results.push(...phaseResults);
  }
  if (cacheFile && !dryRun) writeCache(cacheFile, cache);
  return { ...selection, phase, max_parallel: concurrency, cache_enabled: cacheEnabled, fingerprint, results };
}

function dedupeJobs(jobs, phase) {
  const ownerByCommand = new Map();
  const aliases = new Map();
  const selected = [];
  for (const job of jobs || []) {
    const command = job[`${phase}_cmd`] || '';
    if (!command) continue;
    if (ownerByCommand.has(command)) {
      aliases.set(job.module, ownerByCommand.get(command));
      continue;
    }
    ownerByCommand.set(command, job.module);
    selected.push({ module: job.module, command, depends_on: job.depends_on || [] });
  }
  const canonical = (module) => {
    let current = module;
    const visited = new Set();
    while (aliases.has(current) && !visited.has(current)) {
      visited.add(current);
      current = aliases.get(current);
    }
    return current;
  };
  return selected.map((job) => ({
    ...job,
    depends_on: [...new Set(job.depends_on.map(canonical).filter((dependency) => dependency !== job.module))],
  }));
}

async function executeDag({ jobs, cwd, phase, fingerprint, cache, cacheEnabled, dryRun, maxParallel, runner }) {
  const pending = new Map(jobs.map((job) => [job.module, job]));
  const completed = new Set();
  const results = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((job) => job.depends_on.every((dependency) => completed.has(dependency) || !pending.has(dependency)));
    if (ready.length === 0) throw new Error(`[cc-nexs] cyclic build module dependencies: ${[...pending.keys()].join(', ')}`);
    const batch = ready.slice(0, maxParallel);
    for (const job of batch) pending.delete(job.module);
    const batchResults = await Promise.all(batch.map(async (job) => {
      const key = cacheKey({ phase, command: job.command, fingerprint });
      if (cacheEnabled && cache.successes[key]) {
        return { module: job.module, phase, command: job.command, status: 'cached', cache_key: key };
      }
      if (dryRun) return { module: job.module, phase, command: job.command, status: 'planned', cache_key: key };
      const started = Date.now();
      const exitCode = await runner({ cwd, command: job.command, module: job.module, phase });
      if (exitCode !== 0) throw new Error(`[cc-nexs] ${phase} failed for ${job.module}: ${job.command}`);
      cache.successes[key] = { completed_at: new Date().toISOString(), module: job.module, phase, command: job.command };
      return { module: job.module, phase, command: job.command, status: 'passed', duration_ms: Date.now() - started, cache_key: key };
    }));
    for (const result of batchResults) completed.add(result.module);
    results.push(...batchResults);
  }
  return results;
}

function runShellCommand({ cwd, command, module, phase }) {
  return new Promise((resolvePromise) => {
    process.stderr.write(`\n▶ [${phase}/${module}] ${command}\n`);
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit', env: process.env });
    child.once('error', () => resolvePromise(1));
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
}

function candidateFingerprint(cwd, diffBase) {
  try {
    const hash = createHash('sha256');
    for (const args of [
      ['rev-parse', 'HEAD'],
      ['rev-parse', diffBase],
      ['diff', '--binary', `${diffBase}...HEAD`],
      ['diff', '--binary'],
      ['diff', '--binary', '--cached'],
      ['status', '--porcelain=v1', '-z'],
    ]) {
      hash.update(execFileSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }));
      hash.update('\0');
    }
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' })
      .split('\0').filter(Boolean).sort();
    for (const file of untracked) {
      hash.update(file);
      const absolute = resolve(cwd, file);
      if (existsSync(absolute)) {
        const stat = lstatSync(absolute);
        if (stat.isFile()) hash.update(readFileSync(absolute));
        else if (stat.isSymbolicLink()) hash.update(`symlink:${readlinkSync(absolute)}`);
      }
      hash.update('\0');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function resolveCacheFile(cwd, cacheRoot) {
  let repository = existsSync(cwd) ? realpathSync(cwd) : resolve(cwd);
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
    repository = realpathSync(resolve(cwd, commonDir));
  } catch {}
  const id = createHash('sha256').update(repository).digest('hex').slice(0, 20);
  const root = cacheRoot || join(homedir(), '.cache', 'cc-nexs', 'build');
  return join(root, `${id}.json`);
}

function readCache(file) {
  if (!existsSync(file)) return { version: 1, successes: {} };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value?.version === 1 && value?.successes ? value : { version: 1, successes: {} };
  } catch {
    return { version: 1, successes: {} };
  }
}

function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}

function cacheKey({ phase, command, fingerprint }) {
  if (!fingerprint) return `disabled:${phase}:${command}`;
  return createHash('sha256').update(JSON.stringify({ phase, command, fingerprint })).digest('hex');
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 16) throw new Error(`[cc-nexs] ${label} must be between 1 and 16`);
  return number;
}

function parseArgs(argv) {
  const options = { cwd: process.cwd(), configRoot: null, phase: 'both', dryRun: false, useCache: true, maxParallel: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cwd') options.cwd = resolve(argv[++index]);
    else if (token.startsWith('--cwd=')) options.cwd = resolve(token.slice('--cwd='.length));
    else if (token === '--config-root') options.configRoot = resolve(argv[++index]);
    else if (token.startsWith('--config-root=')) options.configRoot = resolve(token.slice('--config-root='.length));
    else if (token === '--phase') options.phase = argv[++index];
    else if (token.startsWith('--phase=')) options.phase = token.slice('--phase='.length);
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--no-cache') options.useCache = false;
    else if (token === '--max-parallel') options.maxParallel = argv[++index];
    else if (token.startsWith('--max-parallel=')) options.maxParallel = token.slice('--max-parallel='.length);
    else throw new Error(`[cc-nexs] unknown build option: ${token}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const projectRoot = options.configRoot || findProjectConfigRoot(options.cwd);
  const presetRoot = configuredPluginRoot();
  const { mergedStack } = loadConfig({ projectRoot, ...(presetRoot && { presetRoot }) });
  const result = await executeBuildPlan({ ...options, mergedStack });
  for (const item of result.results) process.stderr.write(`✓ [${item.phase}/${item.module}] ${item.status}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
