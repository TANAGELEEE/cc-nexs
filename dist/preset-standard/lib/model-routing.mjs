import { createHash } from 'node:crypto';

const RISK_ORDER = new Map([
  ['low', 0],
  ['medium', 1],
  ['high', 2],
  ['critical', 3],
]);

const HOTFIX_RISK = {
  P0: 'critical',
  P1: 'high',
  P2: 'medium',
  P3: 'low',
};

const PLAN_SCOPE_START = '<!-- APPROVAL-SCOPE START -->';
const PLAN_SCOPE_END = '<!-- APPROVAL-SCOPE END -->';

export const LEGACY_TEMPLATE_ROLE_MAPS = {
  lean: {
    'lean-planner': 'balanced',
    'lean-developer': 'balanced',
    'lean-reviewer': 'review',
    'lean-verifier': 'balanced',
  },
  hotfix: {
    'hotfix-developer': 'balanced',
    'hotfix-reviewer': 'review',
    'hotfix-verifier': 'balanced',
  },
};

export function normalizeRiskTier(value, { allowAuto = true } = {}) {
  if (value === undefined || value === null || value === '') return allowAuto ? 'auto' : null;
  const normalized = String(value).trim().toLowerCase();
  const aliases = {
    '低': 'low',
    '中': 'medium',
    '高': 'high',
    '关键': 'critical',
    '严重': 'critical',
  };
  const resolved = aliases[normalized] || normalized;
  if ((allowAuto && resolved === 'auto') || RISK_ORDER.has(resolved)) return resolved;
  throw new Error(`[cc-nexs] invalid risk_tier: ${value}; expected auto, low, medium, high, or critical`);
}

export function extractPlanRiskTier(text = '') {
  if (typeof text !== 'string' || !text) return null;
  const patterns = [
    /^\s*-\s*`?risk_tier`?\s*[：:]\s*(auto|low|medium|high|critical|低|中|高|关键|严重)\s*$/i,
    /^\s*-\s*风险等级(?:\s*[（(]\s*risk_tier\s*[）)])?\s*[：:]\s*(auto|low|medium|high|critical|低|中|高|关键|严重)\s*$/i,
  ];
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) matches.push(normalizeRiskTier(match[1]));
    }
  }
  if (matches.length > 1) throw new Error('[cc-nexs] plan.md must contain exactly one risk_tier field');
  return matches[0] || null;
}

export function resolveRiskContext({
  featureConfig = {},
  progress = {},
  planText = '',
  defaultRiskTier = 'medium',
} = {}) {
  if (progress.mode && featureConfig.mode && progress.mode !== featureConfig.mode) {
    throw new Error(`[cc-nexs] model routing mode mismatch: progress=${progress.mode}, config=${featureConfig.mode}`);
  }
  const mode = progress.mode || featureConfig.mode || 'lean';
  if (!['lean', 'hotfix', 'fast', 'full', 'lite'].includes(mode)) {
    throw new Error(`[cc-nexs] invalid mode for model routing: ${mode}`);
  }
  const severity = mode === 'hotfix'
    ? progress.hotfix?.severity || featureConfig.hotfix?.severity || null
    : null;
  const signals = [];
  const explicit = normalizeRiskTier(featureConfig.risk_tier);
  if (explicit !== 'auto') signals.push({ source: 'feature_config', risk_tier: explicit });
  if (severity) {
    const normalizedSeverity = String(severity).toUpperCase();
    if (!HOTFIX_RISK[normalizedSeverity]) throw new Error(`[cc-nexs] invalid hotfix severity for model routing: ${severity}`);
    signals.push({ source: 'hotfix_severity', risk_tier: HOTFIX_RISK[normalizedSeverity] });
  }
  const approvedPlanSignal = mode === 'lean'
    ? resolveApprovedPlanRiskSignal({ progress, planText })
    : null;
  const planRisk = mode !== 'lean' || approvedPlanSignal
    ? null
    : extractPlanRiskTier(approvalScopeText(planText));
  if (approvedPlanSignal) {
    signals.push({
      source: approvedPlanSignal.source,
      risk_tier: approvedPlanSignal.risk_tier,
      status: approvedPlanSignal.status,
      ...(approvedPlanSignal.reason && { reason: approvedPlanSignal.reason }),
    });
  } else if (planRisk && planRisk !== 'auto') {
    signals.push({ source: 'plan', risk_tier: planRisk });
  }
  const fallback = normalizeRiskTier(defaultRiskTier, { allowAuto: false }) || 'medium';
  if (signals.length === 0) signals.push({ source: 'default', risk_tier: fallback });
  const highest = signals.reduce((selected, signal) => (
    RISK_ORDER.get(signal.risk_tier) > RISK_ORDER.get(selected.risk_tier) ? signal : selected
  ));
  return {
    mode,
    severity: severity ? String(severity).toUpperCase() : null,
    risk_tier: highest.risk_tier,
    source: highest.source,
    signals,
    plan_binding_status: approvedPlanSignal?.status || null,
  };
}

export function resolveApprovedPlanRiskSignal({
  progress = {},
  planText = '',
  unknownRiskTier = 'high',
} = {}) {
  if (progress.mode !== 'lean' || progress.gates?.plan?.approved !== true) return null;
  const binding = progress.gates?.plan?.binding || {};
  const boundRisk = normalizeRiskTier(binding.risk_tier);
  if (boundRisk !== 'auto') {
    return { status: 'bound', source: 'gateway_a_binding', risk_tier: boundRisk };
  }

  const legacy = deriveLegacyApprovedPlanRisk(binding, planText);
  if (legacy.risk_tier) {
    return {
      status: 'derived',
      source: 'gateway_a_hashed_scope_derived',
      risk_tier: legacy.risk_tier,
    };
  }
  return {
    status: 'unknown',
    source: 'legacy_gateway_a_unknown',
    risk_tier: normalizeRiskTier(unknownRiskTier, { allowAuto: false }),
    reason: legacy.reason,
  };
}

export function resolveFeatureModelRouting({
  models = {},
  featureConfig = {},
  progress = {},
  planText = '',
} = {}) {
  const context = resolveRiskContext({
    featureConfig,
    progress,
    planText,
    defaultRiskTier: featureConfig.models?.routing?.default_risk_tier
      ?? models?.routing?.default_risk_tier,
  });
  return { context, ...applyModelRouting(models, featureConfig.models || {}, context) };
}

export function applyModelRouting(models = {}, featureModels = {}, context = {}) {
  validateModelRoutingConfig(models?.routing);
  validateModelRoutingConfig(featureModels?.routing);
  const featureWithoutRoles = { ...featureModels };
  delete featureWithoutRoles.roles;
  const merged = deepMerge(models || {}, featureWithoutRoles || {});
  validateModelRoutingConfig(merged?.routing, { profiles: merged?.profiles || {} });
  const baseRoles = clone(merged.roles || {});
  const routedRoles = clone(baseRoles);
  const routing = merged.routing || {};
  const matchedRules = [];
  if (routing.enabled !== false) {
    for (const rule of routing.rules || []) {
      if (!matchesRule(rule, context)) continue;
      for (const [role, selection] of Object.entries(rule.roles || {})) {
        routedRoles[role] = mergeRoleSelection(routedRoles[role], selection);
      }
      matchedRules.push({ id: rule.id, roles: Object.keys(rule.roles || {}) });
    }
  }
  const featureRoleOverrides = clone(featureModels?.roles || {});
  const featureProfileOverrides = Object.entries(featureRoleOverrides)
    .filter(([, selection]) => typeof selection === 'string'
      || (selection && typeof selection === 'object' && Object.hasOwn(selection, 'profile')))
    .map(([role]) => role);
  const finalRoles = clone(routedRoles);
  for (const [role, selection] of Object.entries(featureRoleOverrides)) {
    finalRoles[role] = mergeRoleSelection(routedRoles[role], selection);
  }
  return {
    models: { ...merged, roles: finalRoles },
    decision: {
      enabled: routing.enabled !== false,
      risk_tier: context.risk_tier || null,
      severity: context.severity || null,
      source: context.source || null,
      signals: clone(context.signals || []),
      plan_binding_status: context.plan_binding_status || null,
      matched_rules: matchedRules,
      feature_role_overrides: Object.keys(featureRoleOverrides),
      feature_profile_overrides: featureProfileOverrides,
      base_roles: baseRoles,
      routed_roles: routedRoles,
    },
  };
}

function approvalScopeText(text) {
  if (typeof text !== 'string') return '';
  const start = text.indexOf(PLAN_SCOPE_START);
  const end = text.indexOf(PLAN_SCOPE_END);
  if (start < 0 || end < 0 || end <= start) return text;
  return text.slice(start + PLAN_SCOPE_START.length, end);
}

function deriveLegacyApprovedPlanRisk(binding, planText) {
  if (!binding?.plan_scope_sha256) return { risk_tier: null, reason: 'missing_plan_scope_hash' };
  if (typeof planText !== 'string' || !planText) return { risk_tier: null, reason: 'missing_plan_text' };
  const start = planText.indexOf(PLAN_SCOPE_START);
  const end = planText.indexOf(PLAN_SCOPE_END);
  if (start < 0 || end < 0 || end <= start) return { risk_tier: null, reason: 'missing_approval_scope' };
  const scope = normalizeApprovalText(planText.slice(start + PLAN_SCOPE_START.length, end));
  if (createHash('sha256').update(scope).digest('hex') !== binding.plan_scope_sha256) {
    return { risk_tier: null, reason: 'plan_scope_hash_mismatch' };
  }
  try {
    const riskTier = extractPlanRiskTier(scope);
    if (!riskTier || riskTier === 'auto') return { risk_tier: null, reason: 'unstructured_plan_risk' };
    return { risk_tier: riskTier, reason: null };
  } catch {
    return { risk_tier: null, reason: 'ambiguous_plan_risk' };
  }
}

function normalizeApprovalText(text) {
  return text.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

export function validateModelRoutingConfig(routing, { profiles = null } = {}) {
  if (routing === undefined || routing === null) return true;
  if (typeof routing !== 'object' || Array.isArray(routing)) throw new Error('[cc-nexs] models.routing must be an object');
  assertAllowedKeys(routing, ['enabled', 'default_risk_tier', 'rules'], 'models.routing');
  if (routing.enabled !== undefined && typeof routing.enabled !== 'boolean') throw new Error('[cc-nexs] models.routing.enabled must be boolean');
  if (routing.default_risk_tier !== undefined) normalizeRiskTier(routing.default_risk_tier, { allowAuto: false });
  if (routing.rules !== undefined && !Array.isArray(routing.rules)) throw new Error('[cc-nexs] models.routing.rules must be an array');
  const ids = new Set();
  for (const rule of routing.rules || []) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('[cc-nexs] each models.routing rule must be an object');
    assertAllowedKeys(rule, ['id', 'when', 'roles'], 'models.routing rule');
    if (typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id)) throw new Error('[cc-nexs] models.routing rule ids must be present and unique');
    ids.add(rule.id);
    if (!rule.roles || typeof rule.roles !== 'object' || Array.isArray(rule.roles) || Object.keys(rule.roles).length === 0) {
      throw new Error(`[cc-nexs] models.routing rule ${rule.id} requires roles`);
    }
    const when = rule.when || {};
    if (typeof when !== 'object' || Array.isArray(when)) throw new Error(`[cc-nexs] models.routing rule ${rule.id} when must be an object`);
    assertAllowedKeys(when, ['modes', 'risk_tiers', 'severities'], `${rule.id}.when`);
    validateStringList(when.modes, `${rule.id}.when.modes`, (value) => {
      if (!['lean', 'hotfix', 'fast', 'full', 'lite'].includes(value)) {
        throw new Error(`[cc-nexs] invalid mode in ${rule.id}.when.modes: ${value}`);
      }
    });
    validateStringList(when.risk_tiers, `${rule.id}.when.risk_tiers`, (value) => normalizeRiskTier(value, { allowAuto: false }));
    validateStringList(when.severities, `${rule.id}.when.severities`, (value) => {
      if (!HOTFIX_RISK[String(value).toUpperCase()]) throw new Error(`[cc-nexs] invalid severity in ${rule.id}.when.severities: ${value}`);
    });
    for (const [role, selection] of Object.entries(rule.roles)) {
      validateRoleSelection(selection, `${rule.id}.roles.${role}`, profiles);
    }
  }
  return true;
}

function assertAllowedKeys(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`[cc-nexs] ${path} has unknown keys: ${unknown.join(', ')}`);
}

export function hasLegacyTemplateRoleMap(config = {}, mode = config.mode || 'lean') {
  const expected = LEGACY_TEMPLATE_ROLE_MAPS[mode];
  const roles = config.models?.roles;
  const modelKeys = config.models && typeof config.models === 'object' && !Array.isArray(config.models)
    ? Object.keys(config.models)
    : [];
  if (config.config_version !== undefined || modelKeys.length !== 1 || modelKeys[0] !== 'roles') return false;
  if (!expected || !roles || typeof roles !== 'object' || Array.isArray(roles)) return false;
  const actualEntries = Object.entries(roles).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function mergeRoleSelection(base, override) {
  if (typeof override === 'string' || override === null || typeof override !== 'object' || Array.isArray(override)) {
    return clone(override);
  }
  if (typeof base === 'string') return deepMerge({ profile: base }, override);
  return deepMerge(base || {}, override);
}

function matchesRule(rule, context) {
  const when = rule.when || {};
  if (when.modes?.length && !when.modes.includes(context.mode)) return false;
  if (when.risk_tiers?.length
    && !when.risk_tiers.map((item) => normalizeRiskTier(item, { allowAuto: false })).includes(context.risk_tier)) return false;
  if (when.severities?.length && !when.severities.map((item) => String(item).toUpperCase()).includes(context.severity)) return false;
  return true;
}

function validateRoleSelection(selection, path, profiles) {
  if (typeof selection === 'string') {
    if (!selection.trim()) throw new Error(`[cc-nexs] ${path} must not be empty`);
    validateProfileReference(selection, path, profiles);
    return;
  }
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new Error(`[cc-nexs] ${path} must be a profile name or selection object`);
  }
  if (selection.profile !== undefined) {
    if (typeof selection.profile !== 'string' || !selection.profile.trim()) {
      throw new Error(`[cc-nexs] ${path}.profile must be a non-empty string`);
    }
    validateProfileReference(selection.profile, `${path}.profile`, profiles);
  }
}

function validateProfileReference(profile, path, profiles) {
  if (!profiles || profile === 'inherit') return;
  if (!Object.hasOwn(profiles, profile)) throw new Error(`[cc-nexs] ${path} references unknown model profile: ${profile}`);
}

function validateStringList(value, path, validateItem = null) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[cc-nexs] ${path} must be an array of non-empty strings`);
  }
  if (validateItem) for (const item of value) validateItem(item);
}

function deepMerge(base, override) {
  if (override === undefined) return clone(base);
  if (override === null || typeof override !== 'object' || Array.isArray(override)) return clone(override);
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) out[key] = deepMerge(out[key], value);
  return out;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}
