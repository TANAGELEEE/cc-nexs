const RUNTIMES = new Set(['claude', 'codex', 'pi']);
const EFFORTS = new Set(['inherit', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function detectRuntime(env = process.env) {
  if (env.CC_NEXS_RUNTIME) {
    if (!RUNTIMES.has(env.CC_NEXS_RUNTIME)) throw new Error(`[cc-nexs] invalid CC_NEXS_RUNTIME: ${env.CC_NEXS_RUNTIME}`);
    return env.CC_NEXS_RUNTIME;
  }
  if (env.CODEX_HOME || env.CODEX_THREAD_ID || env.CODEX_SANDBOX) return 'codex';
  // The Pi extension sets CC_NEXS_RUNTIME=pi in its own process. Only the
  // child marker is safe for implicit detection; PI_CODING_AGENT_DIR may be
  // exported in shells that also launch Claude Code or Codex.
  if (env.PI_SUBAGENT_CHILD === '1') return 'pi';
  return 'claude';
}

export function resolveRoleRuntime(preset, role, runtime = detectRuntime(), { models = null } = {}) {
  if (!RUNTIMES.has(runtime)) throw new Error(`[cc-nexs] unsupported runtime: ${runtime}`);
  const definition = preset?.roles?.definitions?.[role];
  if (!definition) throw new Error(`[cc-nexs] unknown role: ${role}`);
  const override = preset?.runtimes?.[runtime]?.roles?.[role] || {};
  const resolved = { ...definition, ...override, runtime };
  const modelRuntime = runtime === 'claude' && resolved.tool === 'codex' ? 'codex' : runtime;
  const modelConfig = models || preset?.models || {};
  const configuredRole = modelConfig?.roles?.[role];
  const roleProfile = typeof configuredRole === 'string'
    ? configuredRole
    : configuredRole?.profile || resolved.model_profile || 'inherit';
  const profile = roleProfile === 'inherit'
    ? {}
    : modelConfig?.profiles?.[roleProfile]?.[modelRuntime] || {};
  const direct = typeof configuredRole === 'object' ? configuredRole?.[modelRuntime] || {} : {};
  const selection = normalizeModelSelection({ ...profile, ...direct }, { role, runtime: modelRuntime, profile: roleProfile });
  resolved.model_profile = roleProfile;
  resolved.model_runtime = modelRuntime;
  resolved.model = selection.model;
  resolved.effort = selection.effort;
  resolved.fallback_models = selection.fallback_models;
  if (runtime === 'codex') {
    resolved.tool = 'native-agent';
    resolved.session_isolation = 'independent';
  } else if (runtime === 'pi') {
    resolved.tool = 'pi-subagent';
    resolved.session_isolation = 'independent';
  }
  return resolved;
}

export function runtimeContract(preset, runtime = detectRuntime(), options = {}) {
  const roles = Object.keys(preset?.roles?.definitions || {});
  return Object.fromEntries(roles.map((role) => [role, resolveRoleRuntime(preset, role, runtime, options)]));
}

function normalizeModelSelection(value, { role, runtime, profile }) {
  if (typeof value === 'string') value = { model: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const model = value.model || 'inherit';
  const effort = value.effort || value.reasoning_effort || value.thinking || 'inherit';
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error(`[cc-nexs] invalid model for ${role}/${runtime} profile ${profile}`);
  }
  if (!EFFORTS.has(effort)) {
    throw new Error(`[cc-nexs] invalid effort for ${role}/${runtime}: ${effort}`);
  }
  const fallbackModels = value.fallback_models || value.fallbackModels || [];
  if (!Array.isArray(fallbackModels) || fallbackModels.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`[cc-nexs] fallback_models for ${role}/${runtime} must be an array of model ids`);
  }
  return { model, effort, fallback_models: [...fallbackModels] };
}
