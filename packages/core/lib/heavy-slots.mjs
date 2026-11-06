// Heavy commands (production builds, Maven test runs, dev servers) from every task in a
// workspace share one machine. Each runs through a workspace-wide slot, waiting when all
// slots are busy, with a per-process memory cap, so parallel tasks queue instead of
// exhausting memory and failing a verification round.
//
//   workflow.local_verify.heavy:
//     slots: 2                    concurrent heavy commands in this workspace
//     wait_minutes: 60            give up waiting for a slot after this long
//     node_max_old_space_mb: 4096 added to NODE_OPTIONS unless it already sets one
//     java_max_heap: 2g           added to MAVEN_OPTS unless it already sets -Xmx

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { findWorkspaceRoot, loadCandidateConfig } from './candidate-context.mjs';
import { resolveCliCommand } from './review-panel.mjs';

const DEFAULTS = { slots: 2, wait_minutes: 60, node_max_old_space_mb: 4096, java_max_heap: '2g' };
const POLL_MS = 5000;
const ORPHAN_MS = 60000;

export function heavySettings(config) {
  const settings = { ...DEFAULTS, ...(config?.mergedWorkflow?.local_verify?.heavy || {}) };
  if (!Number.isInteger(settings.slots) || settings.slots < 1) throw new Error('[cc-nexs] workflow.local_verify.heavy.slots must be a positive integer');
  return settings;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function readOwner(slot) {
  try { return JSON.parse(readFileSync(join(slot, 'owner.json'), 'utf8')); } catch { return null; }
}

// A slot whose owner process is gone (on this host), or that never got an owner, is free.
function reclaimIfStale(slot, now) {
  let stat;
  try { stat = statSync(slot); } catch { return; }
  const owner = readOwner(slot);
  const stale = owner
    ? owner.hostname === hostname() && !processAlive(owner.pid)
    : now - stat.mtimeMs > ORPHAN_MS;
  if (stale) rmSync(slot, { recursive: true, force: true });
}

export function acquireHeavySlot({ root, slots, label, waitMs, sleep = sleepSync, now = Date.now }) {
  const dir = join(root, '.cc-nexs', 'runtime', 'heavy');
  mkdirSync(dir, { recursive: true });
  const started = now();
  for (;;) {
    for (let index = 1; index <= slots; index += 1) {
      const slot = join(dir, `slot-${index}`);
      reclaimIfStale(slot, now());
      try {
        mkdirSync(slot);
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
      writeFileSync(join(slot, 'owner.json'), `${JSON.stringify({ pid: process.pid, hostname: hostname(), label, started_at: new Date().toISOString() })}\n`);
      return { slot: index, waitedMs: now() - started, release: () => rmSync(slot, { recursive: true, force: true }) };
    }
    if (now() - started >= waitMs) {
      const busy = readdirSync(dir).map((name) => readOwner(join(dir, name))).filter(Boolean).map((owner) => `${owner.label} (pid ${owner.pid})`);
      throw new Error(`[cc-nexs] no heavy slot freed within ${Math.round(waitMs / 60000)} minutes; running: ${busy.join(', ') || 'unknown'}`);
    }
    sleep(POLL_MS);
  }
}

// The memory cap for one heavy process, unless the caller already chose one.
export function heavyEnv(env, settings) {
  const next = { ...env };
  if (settings.node_max_old_space_mb && !/--max-old-space-size/.test(env.NODE_OPTIONS || '')) {
    next.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--max-old-space-size=${settings.node_max_old_space_mb}`;
  }
  if (settings.java_max_heap && !/-Xmx/.test(env.MAVEN_OPTS || '')) {
    next.MAVEN_OPTS = `${env.MAVEN_OPTS ? `${env.MAVEN_OPTS} ` : ''}-Xmx${settings.java_max_heap}`;
  }
  return next;
}

export function runHeavy({ cwd = process.cwd(), command = [], env = process.env, spawn = spawnSync, sleep = sleepSync } = {}) {
  if (command.length === 0) throw new Error('usage: heavy -- <command> [args...]');
  const root = findWorkspaceRoot(cwd);
  const settings = heavySettings(loadCandidateConfig(root));
  const slot = acquireHeavySlot({ root, slots: settings.slots, label: command.join(' ').slice(0, 120), waitMs: settings.wait_minutes * 60000, sleep });
  try {
    const resolved = resolveCliCommand(command[0], command.slice(1));
    const result = spawn(resolved.command, resolved.args, { cwd, stdio: 'inherit', env: heavyEnv(env, settings) });
    if (result.error) throw new Error(`[cc-nexs] could not run ${command[0]}: ${result.error.message}`);
    return { kind: 'heavy', ran: command[0], slot: slot.slot, waited_ms: slot.waitedMs, status: result.status ?? 1, signal: result.signal || null };
  } finally {
    slot.release();
  }
}
