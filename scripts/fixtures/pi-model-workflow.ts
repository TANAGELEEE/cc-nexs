import { Type } from '@earendil-works/pi-ai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
export default function(pi) {
 pi.registerTool({ name:'cc_live_probe', label:'cc live probe', description:'Run the authorized cc-nexs model dispatch compatibility smoke once.', parameters:Type.Object({}),
 async execute(id,params,signal,update,ctx) {
  const call=async(name,args)=> { const o=await ctx.executeTool(name,args); if(o.isError) throw Error(JSON.stringify(o.result)); return o.result.details; };
  const context='live-tintin-'+Date.now();
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
  const completed=new Map(); const listeners=['subagents:completed','subagents:failed'].map(e=>pi.events.on(e,r=>completed.set(r.id,r)));
  let wake; const completion=new Promise(resolve=>wake=resolve);
  const wakes=['subagents:completed','subagents:failed'].map(e=>pi.events.on(e,r=>wake(r)));
  const dispatched=await call('cc_nexs_dispatch',{tasks:[{agent:'cc-nexs.lean-developer',task:`Authorized cc-nexs adapter smoke only. Do not change files. Use bash pwd once to verify your working directory is ${assignedCwd}, then reply exactly CC_NEXS_ADAPTER_OK. This is not feature development.`,cwd:assignedCwd,model:selection.model,effort:selection.effort}],concurrency:1});
  assert(dispatched.children[0].id,JSON.stringify(dispatched));
  const childId=dispatched.children[0].id;
  const result=completed.get(childId)||await completion;
  [...listeners,...wakes].forEach(f=>f());
  assert.equal(result.id,childId); assert.equal(result.status,'completed'); assert.match(result.result,/CC_NEXS_ADAPTER_OK/);
  const actual=await ctx.executeTool('get_subagent_result',{agent_id:childId,verbose:true}); assert(!actual.isError);
  assert(JSON.stringify(actual.result).includes(assignedCwd), 'Actual child conversation must contain assigned cwd');
  assert(result.toolUses >= 1, 'Child must verify cwd through a real tool');
  await gateway('result',{batchId:first.batch.id,role:'lean-developer',outcome:'succeeded',evidence:`${childId}: ${result.result}`});
  const inspect=await gateway('inspect'); assert.equal(inspect.learnedCount,1);
  const {proposal,...reuseTask}=task;
  const second=await gateway('prepare',{preset,tasks:[reuseTask]});
  assert.equal(second.batch.rows[0].source,'successful-dispatch'); assert.equal(second.showPreview,false); assert.equal(second.batch.rows[0].selection.model,model);
  const report={api:dispatched.api,modelCount:catalog.models.length,model,childId,status:result.status,toolUses:result.toolUses,preview:first.preview,cacheSource:second.batch.rows[0].source,secondPreview:second.showPreview,discoveryCalls:1};
  writeFileSync(process.env.CC_NEXS_PI_SMOKE_REPORT,JSON.stringify(report,null,2));
  return {content:[{type:'text',text:JSON.stringify(report)}],details:report};
 }});
}
