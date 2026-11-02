import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_MIN_FREE_GB = 10;
const BYTES_PER_GB = 1024 ** 3;
const DRIVER_EXIT_GRACE_MS = 60_000;
const NESTED_SOURCE_DEPTH = 4;

export function verifyArtifactRoot(root) {
  return join(root, '.cc-nexs', 'runtime', 'verify');
}

function attemptNumbers(taskDir) {
  return readdirSync(taskDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);
}

function readReceipt(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8')); } catch { return null; }
}

function writeReceipt(attempt) {
  const file = join(attempt.dir, 'receipt.json');
  writeFileSync(`${file}.tmp`, `${JSON.stringify(attempt.receipt, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

export function beginVerifyAttempt({ root, taskId, source, fingerprint, timeoutMs }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(taskId || '')) throw new Error(`[cc-nexs] invalid verify task id: ${taskId}`);
  const base = verifyArtifactRoot(root);
  const taskDir = join(base, taskId);
  mkdirSync(taskDir, { recursive: true });
  // A workspace root inside a Git repository must stay clean for candidate checks.
  writeFileSync(join(base, '.gitignore'), '*\n');
  let number = (attemptNumbers(taskDir).at(-1) || 0) + 1;
  while (true) {
    try { mkdirSync(join(taskDir, String(number))); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; number += 1; }
  }
  const dir = join(taskDir, String(number));
  const attempt = {
    dir,
    id: String(number),
    scratchDir: join(dir, 'scratch'),
    artifactsDir: join(dir, 'artifacts'),
    stdout: '',
    receipt: {
      schema_version: 1,
      task: taskId,
      attempt: String(number),
      status: 'running',
      pid: process.pid,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + timeoutMs + DRIVER_EXIT_GRACE_MS).toISOString(),
      source,
      candidate_fingerprint: fingerprint,
      logs: {},
    },
  };
  // The receipt exists before scratch does, so a concurrent reclaim always sees the attempt as running.
  writeReceipt(attempt);
  mkdirSync(attempt.artifactsDir);
  mkdirSync(attempt.scratchDir);
  return attempt;
}

export function saveDriverOutput(attempt, { stdout, stderr }) {
  attempt.stdout = stdout ?? '';
  for (const [name, text] of [['stdout', stdout ?? ''], ['stderr', stderr ?? '']]) {
    const file = `driver.${name}.log`;
    try {
      writeFileSync(join(attempt.dir, file), text);
      attempt.receipt.logs[name] = { file, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
    } catch { /* A full disk must not replace the driver's own result. */ }
  }
}

function dirtySourceIn(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  if (entries.some((entry) => entry.name === '.git')) {
    try {
      return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() ? dir : null;
    } catch { return dir; }
  }
  if (depth >= NESTED_SOURCE_DEPTH) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const found = dirtySourceIn(join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

function disposeScratch(attempt) {
  if (!existsSync(attempt.scratchDir)) return { scratch: 'removed' };
  const dirty = dirtySourceIn(attempt.scratchDir);
  if (dirty) return { scratch: 'retained', scratch_reason: `uncommitted source in ${dirty}` };
  if (attempt.stdout.includes(attempt.scratchDir)) return { scratch: 'retained', scratch_reason: 'evidence references scratch_dir' };
  try {
    rmSync(attempt.scratchDir, { recursive: true, force: true, maxRetries: 3 });
    return { scratch: 'removed' };
  } catch (error) {
    return { scratch: 'cleanup_failed', scratch_reason: error.message };
  }
}

// Runs from a finally block: scratch goes first so the receipt can still land on a full disk.
export function finishVerifyAttempt(attempt, { status, error = null }) {
  const disposal = disposeScratch(attempt);
  Object.assign(attempt.receipt, { status, error, ended_at: new Date().toISOString() }, disposal);
  try { writeReceipt(attempt); } catch { /* A dead pid already marks this attempt inactive. */ }
}

function isRunning(receipt) {
  if (receipt.status !== 'running' || Date.now() > Date.parse(receipt.deadline_at)) return false;
  try { process.kill(receipt.pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function classifyAttempt({ dir, taskId, number, latest, task }) {
  const scratch = join(dir, 'scratch');
  const keep = (reason) => ({ kind: 'verify-attempt', path: dir, action: 'keep', reason });
  const receipt = readReceipt(dir);
  if (!receipt) return keep('no attempt receipt; inspect manually');
  if (isRunning(receipt)) return keep(`attempt running (pid ${receipt.pid})`);
  const hasScratch = existsSync(scratch);
  if (hasScratch && dirtySourceIn(scratch)) return keep('uncommitted source in scratch; inspect manually');
  if (task && !task.active) return { kind: 'verify-attempt', path: dir, action: 'reclaim', reason: `task ${taskId} complete` };
  if (!hasScratch) return keep(task ? `active task ${taskId} (${task.state}); logs retained` : 'no task state found; inspect manually');
  if (receipt.scratch === 'retained' && number === latest) return keep(`latest evidence references this scratch: ${receipt.scratch_reason}`);
  return { kind: 'verify-scratch', path: scratch, action: 'reclaim', reason: 'inactive attempt; rebuildable scratch' };
}

export function classifyVerifyArtifacts({ root, tasks }) {
  const base = verifyArtifactRoot(root);
  if (!existsSync(base)) return [];
  const entries = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskDir = join(base, entry.name);
    const numbers = attemptNumbers(taskDir);
    for (const number of numbers) {
      entries.push(classifyAttempt({ dir: join(taskDir, String(number)), taskId: entry.name, number, latest: numbers.at(-1), task: tasks.byFeature.get(entry.name) }));
    }
  }
  return entries;
}

export function freeBytesAt(path) {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
}

export function minFreeGb(localVerify) {
  const value = Number(localVerify?.min_free_gb ?? DEFAULT_MIN_FREE_GB);
  if (!Number.isFinite(value) || value < 0) throw new Error('[cc-nexs] local verification min_free_gb must be a non-negative number');
  return value;
}

// Candidate worktrees may sit on another volume than the workspace, so each device is measured once.
export function lowVolumes({ paths, thresholdGb, freeBytes = freeBytesAt }) {
  const volumes = new Map();
  for (const path of paths) {
    const device = statSync(path).dev;
    if (!volumes.has(device)) volumes.set(device, { path, freeBytes: freeBytes(path) });
  }
  return [...volumes.values()].filter((volume) => volume.freeBytes < thresholdGb * BYTES_PER_GB);
}

export function formatGb(bytes) {
  return (bytes / BYTES_PER_GB).toFixed(1);
}
