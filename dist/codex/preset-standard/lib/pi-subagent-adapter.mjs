import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { matchFrontmatter } from './frontmatter.mjs';

// Pi core has no subagent tool. cc-nexs runs each role child as its own headless
// `pi --mode json` process, so the process-wide role guard applies to exactly one role.
export const PI_CHILD_ROLE_ENV = 'CC_NEXS_CHILD_ROLE';
const THINKING_LEVELS = ['inherit', 'low', 'medium', 'high', 'xhigh', 'max'];
const CHILD_ENV_KEYS = ['CC_NEXS_PROGRESS_FILE', 'CC_NEXS_REQ_DIR', 'BUG_FILE'];

export function piTask(task) {
  if (!/^cc-nexs\.[a-z-]+$/.test(task.agent) || !task.task?.trim()
    || !isAbsolute(task.cwd || '') || !statSync(task.cwd).isDirectory()) {
    throw new Error('[cc-nexs] task requires a cc-nexs role, prompt and existing absolute assigned cwd');
  }
  if (task.effort && !THINKING_LEVELS.includes(task.effort)) {
    throw new Error('[cc-nexs] unsupported Pi thinking level');
  }
  const unknownEnv = Object.keys(task.env || {}).filter((key) => !CHILD_ENV_KEYS.includes(key));
  if (unknownEnv.length) throw new Error(`[cc-nexs] child env only accepts ${CHILD_ENV_KEYS.join(', ')}`);
  return task;
}

export function piRoleSpec(agentsDir, agent) {
  const text = readFileSync(join(agentsDir, `${agent.slice('cc-nexs.'.length)}.md`), 'utf8');
  const match = matchFrontmatter(text);
  if (!match) throw new Error(`[cc-nexs] Pi role ${agent} has no frontmatter`);
  const list = (key) => (match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1] || '')
    .split(',').map((item) => item.trim()).filter(Boolean);
  return { tools: list('tools'), skills: list('skills'), systemPrompt: text.slice(match[0].length) };
}

export function piChildArgs(task, role, defaults, promptFile) {
  const model = task.model && task.model !== 'inherit' ? task.model : defaults.model;
  const thinking = task.effort && task.effort !== 'inherit' ? task.effort : defaults.thinking;
  return [
    '--mode', 'json', '-p', '--no-session',
    ...(model ? ['--model', model] : []),
    ...(thinking ? ['--thinking', thinking] : []),
    '--tools', role.tools.join(','),
    // Roles that name skills (ego-browser) keep discovery; the rest stay isolated.
    ...(role.skills.length ? [] : ['--no-skills']),
    '--system-prompt', promptFile,
    `Task: ${task.task}`,
  ];
}

// Reduce a JSON-mode event stream to the child's final assistant outcome.
export function piChildOutcome(lines) {
  const outcome = { output: '', stopReason: null, errorMessage: null, aborted: false };
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'agent_settled') outcome.aborted = event.aborted === true;
    if (event.type !== 'message_end' || event.message?.role !== 'assistant') continue;
    const text = (event.message.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (text) outcome.output = text;
    outcome.stopReason = event.message.stopReason || null;
    outcome.errorMessage = event.message.errorMessage || null;
  }
  return outcome;
}

export function runPiChild(task, { agentsDir, invocation, defaults, signal, spawnImpl = spawn }) {
  const role = piRoleSpec(agentsDir, task.agent);
  const promptDir = mkdtempSync(join(tmpdir(), 'cc-nexs-role-'));
  const promptFile = join(promptDir, 'system-prompt.md');
  writeFileSync(promptFile, role.systemPrompt, { encoding: 'utf8', mode: 0o600 });
  const args = piChildArgs(task, role, defaults, promptFile);
  const modelIndex = args.indexOf('--model');
  const base = { agent: task.agent, cwd: task.cwd, model: modelIndex === -1 ? null : args[modelIndex + 1] };

  return new Promise((resolve) => {
    const lines = [];
    let buffer = '';
    let stderr = '';
    let done = false;
    const finish = (exitCode, spawnError) => {
      if (done) return;
      done = true;
      rmSync(promptDir, { recursive: true, force: true });
      if (buffer.trim()) lines.push(buffer);
      const outcome = piChildOutcome(lines);
      const failed = exitCode !== 0 || outcome.aborted || outcome.errorMessage
        || ['error', 'aborted'].includes(outcome.stopReason);
      resolve({
        ...base,
        ok: !failed,
        exitCode,
        stopReason: outcome.stopReason,
        output: outcome.output,
        ...(failed ? { error: spawnError || outcome.errorMessage || stderr.trim().slice(-4000) || `exit ${exitCode}` } : {}),
      });
    };
    const child = spawnImpl(invocation.command, [...invocation.args, ...args], {
      cwd: task.cwd,
      env: { ...process.env, ...task.env, [PI_CHILD_ROLE_ENV]: task.agent },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // JSONL records split only on LF; Unicode separators may appear inside strings.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const parts = (buffer + chunk).split('\n');
      buffer = parts.pop();
      lines.push(...parts);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', (error) => finish(1, error.message));
    child.on('close', (code) => finish(code ?? 1));
    const kill = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    if (signal?.aborted) kill();
    else signal?.addEventListener('abort', kill, { once: true });
  });
}

// One bounded wave: every sibling starts before any result is collected.
export function runPiWave(tasks, options) {
  return Promise.all(tasks.map((task) => runPiChild(task, options).then((result) => {
    options.onChildDone?.(result);
    return result;
  })));
}
