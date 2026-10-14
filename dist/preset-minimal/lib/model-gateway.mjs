import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { canonicalJson } from './canonical-json.mjs';
import { resolveRoleRuntime } from './runtime-resolver.mjs';

const hash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const difficulties = ['routine', 'moderate', 'complex'];

// Advisory dispatch state is separate from feature approvals and candidate evidence.
export function modelGateway(operation, request, { cwd = process.cwd() } = {}) {
  const { runtime, context } = request;
  if (!['claude', 'codex', 'pi'].includes(runtime) || typeof context !== 'string' || !context.trim()) {
    throw new Error('[cc-nexs] model gateway requires runtime and a non-secret host/account context key');
  }
  const directory = join(resolve(cwd), '.cc-nexs', 'model-dispatch');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${hash({ runtime, context })}.json`);
  const lock = `${file}.lock`;
  const owner = { pid: process.pid, createdAt: Date.now(), token: randomUUID() };
  let lockOwned = false;
  for (let attempt = 0; attempt < 2 && !lockOwned; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: 'wx' });
      lockOwned = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const current = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
        if (!Number.isInteger(current.pid) || current.pid <= 0) throw new Error('invalid lock owner');
        try { process.kill(current.pid, 0); } catch (probeError) { stale = probeError.code === 'ESRCH'; }
      } catch { stale = false; }
      if (!stale) throw new Error('[cc-nexs] model gateway is busy; retry the same request');
      // Only one contender may reap a dead owner; unknown owners stay locked.
      try { mkdirSync(join(lock, 'recovery')); }
      catch { throw new Error('[cc-nexs] model gateway is busy; retry the same request'); }
      try {
        const current = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
        let dead = false;
        try { process.kill(current.pid, 0); } catch (probeError) { dead = probeError.code === 'ESRCH'; }
        if (!dead) throw new Error('[cc-nexs] model gateway is busy; retry the same request');
        rmSync(join(lock, 'owner.json'));
      } finally { rmdirSync(join(lock, 'recovery')); }
      rmdirSync(lock);
    }
  }
  if (!lockOwned) throw new Error('[cc-nexs] model gateway is busy; retry the same request');
  try {
    const state = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : { runtime, context, catalogs: {}, learned: {}, preferences: {}, batches: {} };
    if (state.runtime !== runtime || state.context !== context) throw new Error('[cc-nexs] model gateway context mismatch');
    const result = applyOperation(operation, request, state);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } finally { rmSync(temporary, { force: true }); }
    if (result.batch) {
      const preview = join(directory, `${result.batch.id}.md`);
      writeFileSync(preview, renderPreview(result.batch), { mode: 0o600 });
      return { ...result, preview, stateFile: file, blocking: false };
    }
    return { ...result, stateFile: file, blocking: false };
  } finally { rmSync(lock, { recursive: true }); }
}

function applyOperation(operation, request, state) {
  if (operation === 'inspect') {
    if (request.refresh === true) state.catalogs = {};
    if (request.details === true) return { catalogs: state.catalogs, learned: state.learned, preferences: state.preferences };
    return {
      catalogs: Object.fromEntries(Object.entries(state.catalogs).map(([runtime, catalog]) => [
        runtime, { runtime, source: catalog.source, modelCount: catalog.models.length },
      ])),
      learnedCount: Object.keys(state.learned).length,
      preferenceCount: Object.keys(state.preferences).length,
    };
  }
  if (operation === 'prepare') {
    if (!request.preset || !Array.isArray(request.tasks) || !request.tasks.length) {
      throw new Error('[cc-nexs] model gateway requires a preset and nonempty tasks');
    }
    const catalogs = { ...state.catalogs };
    for (const [executor, catalog] of Object.entries(request.catalogs || {})) {
      if (!['claude', 'codex', 'pi'].includes(executor) || catalog.runtime !== executor || !Array.isArray(catalog.models)
        || catalog.models.some((model) => !model || typeof model.id !== 'string' || !model.id.trim()
          || (model.efforts !== undefined && (!Array.isArray(model.efforts) || model.efforts.some((effort) => typeof effort !== 'string'))))) {
        throw new Error('[cc-nexs] invalid model gateway catalog');
      }
      // Persist only public model capabilities, never provider auth/config objects.
      catalogs[executor] = {
        runtime: executor, source: String(catalog.source || 'host'),
        models: catalog.models.map(({ id, name, description, efforts }) => ({
          id, ...(typeof name === 'string' && { name }),
          ...(typeof description === 'string' && { description }),
          ...(Array.isArray(efforts) && { efforts }),
        })),
      };
    }
    const rows = request.tasks.map((task) => {
      if (!difficulties.includes(task.difficulty) || typeof task.reason !== 'string' || !task.reason.trim()) {
        throw new Error('[cc-nexs] each task needs difficulty and an evidence-based reason');
      }
      const options = request.options || {};
      if (options.modelProposal || options.modelCatalog) throw new Error('[cc-nexs] pass gateway catalogs and per-task proposals separately');
      const configured = resolveRoleRuntime(request.preset, task.role, request.runtime, options);
      const key = hash({
        role: task.role, difficulty: task.difficulty,
        executor: configured.model_runtime, tool: configured.tool,
        model: configured.model, effort: configured.effort, fallbackModels: configured.fallback_models,
        routing: configured.model_routing,
      });
      const catalog = catalogs[configured.model_runtime] || null;
      const remembered = state.preferences[key] || state.learned[key];
      const proposal = state.preferences[key] || task.proposal || remembered || null;
      const resolveSelection = (modelProposal) => resolveRoleRuntime(request.preset, task.role, request.runtime, {
        ...options, modelCatalog: catalog, modelProposal,
      });
      let selection;
      let selectionNotice = null;
      let source = state.preferences[key] ? 'user-preference' : task.proposal ? 'parent-proposal'
        : remembered ? 'successful-dispatch' : 'configured-or-inherited';
      try { selection = resolveSelection(proposal); }
      catch (error) {
        // A stale learned default may fall back to inheritance; explicit choices never silently change.
        if (!remembered || task.proposal || state.preferences[key] || configured.model !== 'inherit') throw error;
        selection = resolveSelection(null);
        source = 'learned-choice-unavailable';
        selectionNotice = {
          type: 'learned-choice-unavailable',
          previousModel: remembered.model,
          action: 'fallback-to-inherit',
        };
        delete state.learned[key];
      }
      if (configured.model !== 'inherit' && proposal && proposal.model !== configured.model) {
        throw new Error(`[cc-nexs] ${task.role} has an explicit model pin; update its configuration before changing the gateway choice`);
      }
      return { key, role: task.role, difficulty: task.difficulty, reason: task.reason, pinned: configured.model !== 'inherit', source, selection, ...(selectionNotice && { selectionNotice }) };
    });
    if (new Set(rows.map((row) => row.role)).size !== rows.length) {
      throw new Error('[cc-nexs] group same-role tasks by difficulty into separate batches');
    }
    const id = request.batchId || randomUUID();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('[cc-nexs] invalid model batch id');
    if (state.batches[id]) throw new Error('[cc-nexs] batch already exists; use view or start');
    const batch = { id, revision: 1, status: 'prepared', rows, results: {} };
    state.catalogs = catalogs;
    state.batches[id] = batch;
    const signature = hash(rows.map((row) => ({
      role: row.role, difficulty: row.difficulty, executor: row.selection.model_runtime,
      model: row.selection.model, effort: row.selection.effort,
    })));
    const previewKey = hash(rows.map((row) => ({
      role: row.role, difficulty: row.difficulty, executor: row.selection.model_runtime,
    })));
    state.previews ||= {};
    const showPreview = rows.some((row) => row.selectionNotice) || state.previews[previewKey] !== signature;
    state.previews[previewKey] = signature;
    return { batch, showPreview };
  }
  const batch = state.batches[request.batchId];
  if (!batch) throw new Error('[cc-nexs] unknown model batch');
  if (operation === 'view') return { batch };
  if (operation === 'start') {
    if (batch.status === 'prepared') {
      // Feedback received before start is applied without a timer or approval wait.
      for (const row of batch.rows) {
        const preference = state.preferences[row.key];
        if (preference) applyChoice(row, preference, state);
      }
      batch.status = 'started';
      batch.revision += 1;
    }
    return { batch };
  }
  const row = batch.rows.find((item) => item.role === request.role);
  if (!row) throw new Error('[cc-nexs] role does not belong to this model batch');
  if (operation === 'feedback') {
    if (request.revision !== batch.revision) throw new Error('[cc-nexs] stale model preview; read the current batch');
    if (typeof request.reason !== 'string' || !request.reason.trim()) throw new Error('[cc-nexs] feedback requires the actual user instruction');
    const choice = { model: request.model, effort: request.effort || row.selection.effort, reason: request.reason };
    const probe = structuredClone(row);
    applyChoice(probe, choice, state);
    state.preferences[row.key] = choice;
    if (batch.status === 'prepared') Object.assign(row, probe);
    batch.revision += 1;
    return { batch, applies: batch.status === 'prepared' ? 'this-batch' : 'next-batch' };
  }
  if (operation === 'result') {
    if (batch.status !== 'started') throw new Error('[cc-nexs] cannot learn from a batch that has not started');
    if (!['succeeded', 'model-unavailable', 'task-failed'].includes(request.outcome)
      || typeof request.evidence !== 'string' || !request.evidence.trim()) {
      throw new Error('[cc-nexs] dispatch result requires outcome and actual execution evidence');
    }
    if (batch.results[row.role]) {
      if (canonicalJson(batch.results[row.role]) !== canonicalJson({ outcome: request.outcome, evidence: request.evidence })) {
        throw new Error('[cc-nexs] dispatch result already recorded');
      }
      return { batch };
    }
    batch.results[row.role] = { outcome: request.outcome, evidence: request.evidence };
    if (request.outcome === 'succeeded') state.learned[row.key] = {
      model: row.selection.model, effort: row.selection.effort,
      reason: `Previous successful dispatch: ${request.evidence}`,
    };
    if (request.outcome === 'model-unavailable') {
      delete state.learned[row.key];
      delete state.catalogs[row.selection.model_runtime];
    }
    batch.revision += 1;
    return { batch };
  }
  throw new Error(`[cc-nexs] unsupported model gateway operation: ${operation}`);
}

function applyChoice(row, choice, state) {
  if (typeof choice.model !== 'string' || !choice.model.trim()) throw new Error('[cc-nexs] user model choice is required');
  const prior = row.selection;
  if (row.pinned && prior.model !== choice.model) {
    throw new Error('[cc-nexs] update the explicit model configuration before changing this choice');
  }
  const executor = prior.model_runtime;
  const preset = {
    roles: { definitions: { [row.role]: { tool: prior.tool } } },
    models: { roles: { [row.role]: { [executor]: { effort: prior.effort } } } },
  };
  const selected = resolveRoleRuntime(preset, row.role, executor, {
    modelCatalog: state.catalogs[executor] || null, modelProposal: choice,
  });
  row.selection = { ...prior, model: selected.model, effort: selected.effort, model_selection: { source: 'user-preference', reason: choice.reason } };
  row.source = 'user-preference';
}

function renderPreview(batch) {
  const cell = (text) => String(text ?? '').replace(/[|\r\n<>]/g, ' ');
  return [
    '# Model dispatch preview', '',
    'Advisory only. No response is required; execution continues with this selection.',
    'Tell the parent which role/model/effort to change. Started roles stay frozen; late feedback applies to the next batch.',
    '', `Batch: ${batch.id} | revision: ${batch.revision} | status: ${batch.status}`, '',
    '| Role | Difficulty | Executor | Model | Effort | Selection source | Task evidence | Selection reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...batch.rows.map((row) => `| ${[row.role, row.difficulty, row.selection.model_runtime, row.selection.model, row.selection.effort, row.source, row.reason, row.selection.model_selection.reason || 'Configured profile or host inheritance'].map(cell).join(' | ')} |`),
    ...batch.rows.filter((row) => row.selectionNotice).map((row) => `Warning: ${cell(row.role)} learned model ${cell(row.selectionNotice.previousModel)} is unavailable; falling back to host inheritance.`),
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [operation, requestFile] = process.argv.slice(2);
    console.log(JSON.stringify(modelGateway(operation, JSON.parse(readFileSync(requestFile, 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
