import { applyModelRouting, resolveFeatureModelRouting } from './model-routing.mjs';

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

export function resolveRoleRuntime(preset, role, runtime = detectRuntime(), {
  models = null,
  featureModels = null,
  modelContext = null,
  featureConfig = null,
  progress = null,
  planText = '',
} = {}) {
  if (!RUNTIMES.has(runtime)) throw new Error(`[cc-nexs] unsupported runtime: ${runtime}`);
  const definition = preset?.roles?.definitions?.[role];
  if (!definition) throw new Error(`[cc-nexs] unknown role: ${role}`);
  const override = preset?.runtimes?.[runtime]?.roles?.[role] || {};
  const resolved = { ...definition, ...override, runtime };
  const modelRuntime = runtime === 'claude' && resolved.tool === 'codex' ? 'codex' : runtime;
  const baseModels = models || preset?.models || {};
  const effectiveFeatureConfig = {
    ...(featureConfig || {}),
    models: featureModels || featureConfig?.models || {},
  };
  const routingResult = modelContext
    ? applyModelRouting(baseModels, effectiveFeatureConfig.models, modelContext)
    : resolveFeatureModelRouting({
        models: baseModels,
        featureConfig: effectiveFeatureConfig,
        progress: progress || {},
        planText,
      });
  const modelConfig = routingResult.models;
  const configuredRole = modelConfig?.roles?.[role];
  const roleProfile = typeof configuredRole === 'string'
    ? configuredRole
    : configuredRole?.profile || resolved.model_profile || 'inherit';
  if (roleProfile !== 'inherit' && !Object.hasOwn(modelConfig?.profiles || {}, roleProfile)) {
    throw new Error(`[cc-nexs] role ${role} references unknown model profile: ${roleProfile}`);
  }
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
  const roleRules = routingResult.decision.matched_rules.filter((rule) => rule.roles.includes(role));
  const featureOverride = routingResult.decision.feature_role_overrides.includes(role);
  const featureProfileOverride = routingResult.decision.feature_profile_overrides.includes(role);
  resolved.model_routing = {
    enabled: routingResult.decision.enabled,
    risk_tier: routingResult.decision.risk_tier,
    severity: routingResult.decision.severity,
    source: routingResult.decision.source,
    signals: routingResult.decision.signals,
    plan_binding_status: routingResult.decision.plan_binding_status,
    matched_rules: roleRules.map((rule) => rule.id),
    auto_upgraded: !featureProfileOverride && roleRules.length > 0
      && !sameSelection(routingResult.decision.base_roles[role], routingResult.decision.routed_roles[role]),
    feature_override: featureOverride,
    feature_profile_override: featureProfileOverride,
  };
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

function sameSelection(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
