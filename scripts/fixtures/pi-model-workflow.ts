import { Type } from '@earendil-works/pi-ai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
export default function(pi) {
 pi.registerTool({ name:'cc_live_probe', label:'cc live probe', description:'Run the authorized cc-nexs model dispatch compatibility smoke once.', parameters:Type.Object({}),
 async execute(id,params,signal,update,ctx) {
  const call=async(name,args)=> { const o=await ctx.executeTool(name,args); if(o.isError) throw Error(JSON.stringify(o.result)); return o.result.details; };
  const context='live-pi-process-'+Date.now();
  const base={runtime:'pi',context};
  const gateway=(operation,fields={})=>call('cc_nexs_model_gateway',{operation,request:JSON.stringify({...base,...fields})});
  const catalog=await call('cc_nexs_models',{});
  const model=process.env.CC_NEXS_PI_SMOKE_MODEL;
  assert(model, 'Set CC_NEXS_PI_SMOKE_MODEL to an available Pi model');
  assert(catalog.models.some(m=>m.id===model));
  const preset={roles:{definitions:{'lean-developer':{tool:'pi-subagent'}}}};
  const task={role:'lean-developer',difficulty:'routine',reason:'Read-only compatibility smoke with exact marker',proposal:{model,effort:'low',reason:'User-selected available live smoke model'}};
  const first=await gateway('prepare',{preset,catalogs:{pi:catalog},tasks:[task]});
  assert(first.showPreview && !first.blocking);
  const started=await gateway('start',{batchId:first.batch.id});
  const selection=started.batch.rows[0].selection;
  const assignedCwd=join(ctx.cwd,'assigned-worktree');
  mkdirSync(assignedCwd,{recursive:true});
  const assignedOther=join(ctx.cwd,'assigned-other');
  mkdirSync(assignedOther,{recursive:true});
  const probe=(dir)=>`Authorized cc-nexs adapter smoke only, not feature development. Run bash pwd once. Then call the bash tool exactly once with "git commit --allow-empty -m cc-nexs-probe": this checks that the cc-nexs role guard blocks Git mutation, and a block is the expected result, so do not skip the call. Reply with CC_NEXS_ADAPTER_OK, the exact pwd output, and the bash tool result for the git call quoted verbatim.`;
  const dispatched=await call('cc_nexs_dispatch',{tasks:[
   {agent:'cc-nexs.lean-developer',task:probe(assignedCwd),cwd:assignedCwd,model:selection.model,effort:selection.effort},
   {agent:'cc-nexs.lean-reviewer',task:probe(assignedOther),cwd:assignedOther,model:selection.model,effort:selection.effort},
  ],concurrency:2});
  assert.equal(dispatched.api,'pi-process');
  for (const [index,dir] of [assignedCwd,assignedOther].entries()) {
   const child=dispatched.children[index];
   assert(child.ok,JSON.stringify(child)); assert.match(child.output,/CC_NEXS_ADAPTER_OK/); assert(child.output.includes(dir),'child must report its assigned cwd');
  }
  // A child may decline the Git probe under its role contract; at least one attempt must hit the guard.
  assert(dispatched.children.some(c=>/cannot mutate Git/.test(c.output)),'role guard must block Git mutation in a child');
  const childId=dispatched.children.map(c=>c.agent).join(',');
  const result={status:'completed',result:dispatched.children[0].output};
  await gateway('result',{batchId:first.batch.id,role:'lean-developer',outcome:'succeeded',evidence:`${childId}: ${result.result}`});
  const inspect=await gateway('inspect'); assert.equal(inspect.learnedCount,1);
  const {proposal,...reuseTask}=task;
  const second=await gateway('prepare',{preset,tasks:[reuseTask]});
  assert.equal(second.batch.rows[0].source,'successful-dispatch'); assert.equal(second.showPreview,false); assert.equal(second.batch.rows[0].selection.model,model);
  const report={api:dispatched.api,modelCount:catalog.models.length,model,children:dispatched.children.map(c=>({agent:c.agent,cwd:c.cwd,ok:c.ok,model:c.model})),preview:first.preview,cacheSource:second.batch.rows[0].source,secondPreview:second.showPreview,discoveryCalls:1};
  writeFileSync(process.env.CC_NEXS_PI_SMOKE_REPORT,JSON.stringify(report,null,2));
  return {content:[{type:'text',text:JSON.stringify(report)}],details:report};
 }});
}
