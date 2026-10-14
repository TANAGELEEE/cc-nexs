import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Query host metadata only: no inference session, credentials, or project writes.
export async function discoverModels(runtime, { timeoutMs = 15000 } = {}) {
  if (!['codex', 'pi'].includes(runtime)) throw new Error('[cc-nexs] discovery supports codex or pi');
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, runtime === 'codex'
      ? ['app-server']
      : ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-mcp', '--no-skills', '--no-context-files'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let finished = false;
    const models = [];
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve({ runtime, source: `${runtime}-catalog`, discovered_at: new Date().toISOString(), models });
    };
    const timer = setTimeout(() => finish(new Error(`[cc-nexs] ${runtime} model discovery timed out`)), timeoutMs);
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.on('error', () => finish(new Error(`[cc-nexs] cannot start ${runtime} model discovery`)));
    child.stdin.on('error', () => finish(new Error(`[cc-nexs] ${runtime} discovery input closed`)));
    child.on('exit', () => finish(new Error(`[cc-nexs] ${runtime} exited before returning its model catalog`)));
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) return finish(new Error('[cc-nexs] model catalog response too large'));
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let reply;
        try { reply = JSON.parse(line); } catch { continue; }
        if (!['init', 'models'].includes(reply.id)) continue;
        if (reply.error || reply.success === false) return finish(new Error(`[cc-nexs] ${runtime} rejected model discovery`));
        if (reply.id === 'init') {
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 'models', method: 'model/list', params: { includeHidden: false } });
          continue;
        }
        const entries = runtime === 'codex' ? reply.result?.data : reply.data?.models;
        if (!Array.isArray(entries)) return finish(new Error('[cc-nexs] invalid host model catalog'));
        for (const item of entries) {
          const id = runtime === 'pi' ? `${item.provider}/${item.id}` : item.model || item.id;
          if (typeof id !== 'string' || !id.trim()) return finish(new Error('[cc-nexs] invalid host model id'));
          models.push({
            id,
            name: item.displayName || item.name || id,
            description: item.description || '',
            ...(runtime === 'codex' && Array.isArray(item.supportedReasoningEfforts)
              ? { efforts: item.supportedReasoningEfforts.map((effort) => effort.reasoningEffort) } : {}),
            ...(runtime === 'pi' ? { reasoning: Boolean(item.reasoning), input: item.input || [] } : {}),
          });
        }
        if (runtime === 'codex' && reply.result.nextCursor) {
          send({ jsonrpc: '2.0', id: 'models', method: 'model/list', params: { cursor: reply.result.nextCursor, includeHidden: false } });
        } else finish();
      }
    });
    if (runtime === 'codex') send({
      jsonrpc: '2.0', id: 'init', method: 'initialize',
      params: { clientInfo: { name: 'cc-nexs-model-discovery', version: '1' }, capabilities: {} },
    });
    else send({ id: 'models', type: 'get_available_models' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await discoverModels(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
