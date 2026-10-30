import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piChildArgs, piChildOutcome, piRoleSpec, piTask, runPiWave } from './pi-subagent-adapter.mjs';

function agentsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-nexs-agents-'));
  writeFileSync(join(dir, 'lean-developer.md'), '---\nname: lean-developer\ntools: bash, read, write, edit\n---\n\n# Role\nBody\n');
  writeFileSync(join(dir, 'lean-verifier.md'), '---\nname: lean-verifier\ntools: bash, read\nskills: ego-browser\n---\nVerifier\n');
  return dir;
}

function assistantEnd(text, extra = {}) {
  return JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', ...extra } });
}

function fakeSpawn(plan) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    calls.push({ command, args, options });
    const { lines, code, stderr = '' } = plan(options.env.CC_NEXS_CHILD_ROLE, calls.length);
    setImmediate(() => {
      // Split a record across chunks to exercise LF framing.
      const text = `${lines.join('\n')}\n`;
      child.stdout.write(text.slice(0, 7));
      child.stdout.write(text.slice(7));
      child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('validates role, cwd, thinking and child env keys', () => {
  assert.throws(() => piTask({ agent: 'other', task: 'x', cwd: process.cwd() }), /requires/);
  assert.throws(() => piTask({ agent: 'cc-nexs.lean-developer', task: 'x', cwd: 'relative' }), /requires/);
  assert.throws(() => piTask({ agent: 'cc-nexs.qa', task: 'x', cwd: process.cwd(), effort: 'ultra' }), /thinking/);
  assert.throws(() => piTask({ agent: 'cc-nexs.qa', task: 'x', cwd: process.cwd(), env: { PATH: '/x' } }), /child env/);
  assert.equal(piTask({ agent: 'cc-nexs.qa', task: 'x', cwd: process.cwd(), effort: 'max', env: { BUG_FILE: '/b.md' } }).effort, 'max');
});

test('builds isolated headless child arguments from the role file', () => {
  const dir = agentsDir();
  const developer = piRoleSpec(dir, 'cc-nexs.lean-developer');
  assert.deepEqual(developer.tools, ['bash', 'read', 'write', 'edit']);
  assert.match(developer.systemPrompt, /^\n# Role\nBody/);
  assert.doesNotMatch(developer.systemPrompt, /name:/);
  const args = piChildArgs({ task: 'do it', model: 'p/m', effort: 'high' }, developer, { model: 'p/parent', thinking: 'low' }, '/tmp/prompt.md');
  assert.deepEqual(args, ['--mode', 'json', '-p', '--no-session', '--model', 'p/m', '--thinking', 'high',
    '--tools', 'bash,read,write,edit', '--no-skills', '--system-prompt', '/tmp/prompt.md', 'Task: do it']);
  const inherited = piChildArgs({ task: 'x', model: 'inherit', effort: 'inherit' }, piRoleSpec(dir, 'cc-nexs.lean-verifier'), { model: 'p/parent', thinking: 'low' }, '/p');
  assert.deepEqual(inherited.slice(4, 8), ['--model', 'p/parent', '--thinking', 'low']);
  assert.equal(inherited.includes('--no-skills'), false);
});

test('reduces the JSON event stream to the final assistant outcome', () => {
  assert.deepEqual(piChildOutcome(['{"type":"session"}', 'not json', assistantEnd('first'), assistantEnd('DONE'), '{"type":"agent_settled","aborted":false}']),
    { output: 'DONE', stopReason: 'stop', errorMessage: null, aborted: false });
  const failed = piChildOutcome([assistantEnd('', { stopReason: 'error', errorMessage: '404 model not found' })]);
  assert.equal(failed.stopReason, 'error');
  assert.equal(failed.errorMessage, '404 model not found');
});

test('runs a whole wave, keeps order, tags each child and reports only real failures', async () => {
  const dir = agentsDir();
  const { calls, spawnImpl } = fakeSpawn((role) => role === 'cc-nexs.lean-developer'
    ? { lines: [assistantEnd('CC_NEXS_OK')], code: 0 }
    : { lines: [assistantEnd('', { stopReason: 'error', errorMessage: 'quota exceeded' })], code: 1, stderr: 'boom' });
  const done = [];
  const results = await runPiWave([
    { agent: 'cc-nexs.lean-developer', task: 'a', cwd: '/work/a', model: 'p/m', env: { CC_NEXS_PROGRESS_FILE: '/p.json' } },
    { agent: 'cc-nexs.lean-verifier', task: 'b', cwd: '/work/b' },
  ], { agentsDir: dir, invocation: { command: 'node', args: ['/pi/cli.js'] }, defaults: { model: 'p/parent' }, spawnImpl, onChildDone: (r) => done.push(r.agent) });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cwd, '/work/a');
  assert.equal(calls[0].options.env.CC_NEXS_PROGRESS_FILE, '/p.json');
  assert.deepEqual(calls[0].args.slice(0, 2), ['/pi/cli.js', '--mode']);
  const promptFile = calls[0].args[calls[0].args.indexOf('--system-prompt') + 1];
  assert.equal(existsSync(promptFile), false, 'temporary role prompt is removed');
  assert.deepEqual(results.map((r) => [r.agent, r.ok, r.model]), [['cc-nexs.lean-developer', true, 'p/m'], ['cc-nexs.lean-verifier', false, 'p/parent']]);
  assert.equal(results[0].output, 'CC_NEXS_OK');
  assert.equal(results[0].error, undefined);
  assert.equal(results[1].error, 'quota exceeded');
  assert.equal(done.length, 2);
});
