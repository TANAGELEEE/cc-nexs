import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';

export function piSubagentApi(tools) {
  const names = new Set(tools.map((tool) => typeof tool === 'string' ? tool : tool.name));
  if (names.has('subagent') && names.has('subagent_wait')) return 'tasks';
  if (names.has('Agent') && names.has('get_subagent_result')) return 'tintin-rpc-v2';
  throw new Error('[cc-nexs] requires subagent/subagent_wait or Agent/get_subagent_result with RPC v2');
}

export function piTask(task) {
  if (!/^cc-nexs\.[a-z-]+$/.test(task.agent) || !task.task?.trim()
    || !isAbsolute(task.cwd || '') || !statSync(task.cwd).isDirectory()) {
    throw new Error('[cc-nexs] task requires a cc-nexs role, prompt and existing absolute assigned cwd');
  }
  if (task.effort && !['inherit', 'low', 'medium', 'high', 'xhigh', 'max'].includes(task.effort)) {
    throw new Error('[cc-nexs] unsupported Pi thinking level');
  }
  return {
    type: task.agent, prompt: task.task,
    options: {
      description: task.agent, cwd: task.cwd, inheritContext: false, isBackground: true,
      ...(task.model && task.model !== 'inherit' ? { model: task.model } : {}),
      ...(task.effort && task.effort !== 'inherit' ? { thinkingLevel: task.effort } : {}),
    },
  };
}

export function subagentRpc(events, method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const channel = `subagents:rpc:${method}`;
    const unsubscribe = events.on(`${channel}:reply:${requestId}`, (reply) => {
      clearTimeout(timer);
      unsubscribe();
      if (reply.success) resolve(reply.data);
      else reject(new Error(`[cc-nexs] Pi adapter: ${reply.error}`));
    });
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('[cc-nexs] Pi subagent RPC unavailable; requires @tintinweb/pi-subagents RPC v2'));
    }, 5000);
    events.emit(channel, { ...params, requestId });
  });
}
