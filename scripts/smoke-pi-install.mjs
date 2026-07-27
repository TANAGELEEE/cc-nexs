#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const withSubagents = process.env.CC_NEXS_PI_SUBAGENTS_SMOKE === '1';
const probe = spawnSync('pi', ['--version'], { encoding: 'utf8' });
if (probe.error?.code === 'ENOENT') {
  console.log('Pi install smoke skipped: pi executable is not installed in this environment.');
  process.exit(0);
}
if (probe.status !== 0) throw new Error(`pi --version failed: ${probe.stderr || probe.stdout}`);

const agentDir = mkdtempSync(join(tmpdir(), 'cc-nexs-pi-agent-'));

function queryCommands(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--approve'], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Pi RPC command query timed out: ${stderr}`));
    }, 15_000);

    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split('\n');
      stdout = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (record.type === 'response' && record.id === 'cc-nexs-smoke') {
          clearTimeout(timer);
          child.kill('SIGTERM');
          if (!record.success) reject(new Error(`Pi RPC get_commands failed: ${JSON.stringify(record)}`));
          else resolvePromise(record.data?.commands || []);
        }
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code && code !== 143) {
        clearTimeout(timer);
        reject(new Error(`Pi RPC exited ${code}: ${stderr}`));
      }
    });
    child.stdin.write(`${JSON.stringify({ id: 'cc-nexs-smoke', type: 'get_commands' })}\n`);
  });
}

try {
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' };
  if (withSubagents) {
    const installEnv = { ...env };
    delete installEnv.PI_OFFLINE;
    execFileSync('pi', ['install', 'npm:pi-subagents@0.35.1'], { env: installEnv, stdio: 'pipe' });
  }
  execFileSync('pi', ['install', root, '--approve'], { env, stdio: 'pipe' });
  const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'));
  const configured = JSON.stringify(settings);
  if (!configured.includes(root)) throw new Error('isolated Pi settings did not register the local cc-nexs package');
  const listed = execFileSync('pi', ['list'], { env, encoding: 'utf8' });
  if (!listed.includes(root) && !listed.includes('cc-nexs')) throw new Error('pi list did not show cc-nexs');
  const commands = await queryCommands(env);
  const names = new Set(commands.map((command) => command.name));
  for (const required of ['cc-nexs:init', 'cc-nexs:run', 'cc-nexs:release-test', 'cc-nexs:hotfix', 'cc-nexs:doctor', 'skill:cc-nexs-run', 'skill:cc-nexs-release-test', 'skill:cc-nexs-hotfix']) {
    if (!names.has(required)) throw new Error(`Pi did not load required command: ${required}`);
  }
  if (withSubagents && !names.has('subagents-doctor')) throw new Error('pi-subagents did not load beside cc-nexs');
  const scope = withSubagents ? 'package, pi-subagents, extension, and skills' : 'package, extension, and skills';
  console.log(`Pi install smoke passed with Pi ${probe.stdout.trim()}: ${scope} loaded in isolation.`);
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
