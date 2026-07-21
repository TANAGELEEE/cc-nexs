const RUNTIMES = new Set(['claude', 'codex', 'pi']);

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

export function resolveRoleRuntime(preset, role, runtime = detectRuntime()) {
  if (!RUNTIMES.has(runtime)) throw new Error(`[cc-nexs] unsupported runtime: ${runtime}`);
  const definition = preset?.roles?.definitions?.[role];
  if (!definition) throw new Error(`[cc-nexs] unknown role: ${role}`);
  const override = preset?.runtimes?.[runtime]?.roles?.[role] || {};
  const resolved = { ...definition, ...override, runtime };
  if (resolved.model && resolved.model !== 'inherit') {
    throw new Error(`[cc-nexs] fixed model ids are not portable; ${role}.model must be inherit`);
  }
  resolved.model = 'inherit';
  if (runtime === 'codex') {
    resolved.tool = 'native-agent';
    resolved.session_isolation = 'independent';
  } else if (runtime === 'pi') {
    resolved.tool = 'pi-subagent';
    resolved.session_isolation = 'independent';
  }
  return resolved;
}

export function runtimeContract(preset, runtime = detectRuntime()) {
  const roles = Object.keys(preset?.roles?.definitions || {});
  return Object.fromEntries(roles.map((role) => [role, resolveRoleRuntime(preset, role, runtime)]));
}
