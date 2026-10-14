import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { piSubagentApi, piTask, subagentRpc } from './pi-subagent-adapter.mjs';

test('detect both APIs and preserve cwd, model and thinking without isolation worktrees', () => {
  assert.equal(piSubagentApi(['Agent', 'get_subagent_result']), 'tintin-rpc-v2');
  assert.equal(piSubagentApi(['subagent', 'subagent_wait']), 'tasks');
  assert.throws(() => piSubagentApi(['Agent']), /requires/);
  const task = piTask({ agent: 'cc-nexs.lean-developer', task: 'test', cwd: process.cwd(), model: 'provider/model', effort: 'high' });
  assert.equal(task.options.cwd, process.cwd());
  assert.equal(task.options.thinkingLevel, 'high');
  assert.equal(task.options.inheritContext, false);
  assert.equal(task.options.isolation, undefined);
  assert.throws(() => piTask({ agent: 'other', task: 'x', cwd: process.cwd() }), /requires/);
  assert.throws(() => piTask({ agent: 'cc-nexs.qa', task: 'x', cwd: process.cwd(), effort: 'ultra' }), /thinking/);
});

test('RPC v2 resolves scoped replies and propagates errors', async () => {
  const bus = new EventEmitter();
  const events = { emit: (...args) => bus.emit(...args), on: (event, handler) => { bus.on(event, handler); return () => bus.off(event, handler); } };
  bus.on('subagents:rpc:ping', ({ requestId }) => bus.emit(`subagents:rpc:ping:reply:${requestId}`, { success: true, data: { version: 2 } }));
  assert.deepEqual(await subagentRpc(events, 'ping'), { version: 2 });
  bus.on('subagents:rpc:spawn', ({ requestId }) => bus.emit(`subagents:rpc:spawn:reply:${requestId}`, { success: false, error: 'bad model' }));
  await assert.rejects(subagentRpc(events, 'spawn'), /bad model/);
  assert.equal(bus.eventNames().length, 2);
});
