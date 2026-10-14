import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverModels } from './model-discovery.mjs';

test('host catalogs handle startup noise, pagination and strip private provider data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-model-discovery-'));
  const previous = process.env.PATH;
  try {
    const script = `#!${process.execPath}
const readline = require('node:readline');
console.log('startup noise');
readline.createInterface({input:process.stdin}).on('line', line => {
  const r=JSON.parse(line);
  if(r.id==='init') console.log(JSON.stringify({id:r.id,result:{}}));
  if(r.id==='models') {
    const model={id:'host-model',model:'host-model',provider:'host',apiKey:'SECRET',baseUrl:'PRIVATE',supportedReasoningEfforts:[{reasoningEffort:'high'}]};
    console.log(JSON.stringify(r.type ? {id:r.id,success:true,data:{models:[model]}} : {id:r.id,result:{data:[model],nextCursor:r.params.cursor ? null : 'page2'}}));
  }
});
`;
    for (const runtime of ['codex', 'pi']) writeFileSync(join(dir, runtime), script, { mode: 0o755 });
    process.env.PATH = `${dir}:${previous}`;
    const codex = await discoverModels('codex');
    assert.equal(codex.models.length, 2);
    assert.deepEqual(codex.models[0].efforts, ['high']);
    const pi = await discoverModels('pi');
    assert.equal(pi.models[0].id, 'host/host-model');
    assert.doesNotMatch(JSON.stringify([codex, pi]), /SECRET|PRIVATE|apiKey|baseUrl/);
    writeFileSync(join(dir, 'pi'), `#!${process.execPath}\nsetInterval(()=>{},1000);`, { mode: 0o755 });
    await assert.rejects(discoverModels('pi', { timeoutMs: 50 }), /timed out/);
    await assert.rejects(discoverModels('claude'), /supports codex or pi/);
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
