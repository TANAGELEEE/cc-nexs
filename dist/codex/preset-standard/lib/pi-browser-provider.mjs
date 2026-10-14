import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PI_PRIMARY_BROWSER_PROVIDER = 'ego-lite';
export const PI_FALLBACK_BROWSER_PROVIDER = '@injaneity/pi-computer-use@0.4.3';

export function inspectPiBrowserCapability({
  projectRoot = process.cwd(),
  env = process.env,
  home = homedir(),
  execFile = execFileSync,
  piListOutput,
} = {}) {
  const ego = inspectEgoLite({ execFile });
  if (ego.ready) return ego;

  const computerUse = inspectComputerUse({ projectRoot, env, home, execFile, piListOutput });
  if (computerUse.ready) {
    return {
      ...computerUse,
      fallback: true,
      primaryFailure: ego.reason,
    };
  }

  return {
    provider: null,
    ready: false,
    fallback: false,
    reason: `${ego.reason}; ${computerUse.reason}`,
  };
}

export function inspectEgoLite({ execFile = execFileSync } = {}) {
  try {
    const output = execFile('ego-browser', ['nodejs'], {
      encoding: 'utf8',
      input: "console.log('ego-browser ready')\n",
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 15_000,
    });
    if (output.includes('ego-browser ready')) {
      return { provider: PI_PRIMARY_BROWSER_PROVIDER, ready: true, fallback: false };
    }
    return { provider: PI_PRIMARY_BROWSER_PROVIDER, ready: false, reason: 'ego lite runtime probe returned unexpected output' };
  } catch {
    return { provider: PI_PRIMARY_BROWSER_PROVIDER, ready: false, reason: 'ego lite skill/CLI/app is unavailable or onboarding is incomplete' };
  }
}

export function inspectComputerUse({
  projectRoot = process.cwd(),
  env = process.env,
  home = homedir(),
  execFile = execFileSync,
  piListOutput,
} = {}) {
  let installed = piListOutput;
  if (installed === undefined) {
    try {
      installed = execFile('pi', ['list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: false, reason: 'unable to inspect installed Pi packages' };
    }
  }
  if (!installed.includes('injaneity/pi-computer-use') && !installed.includes('@injaneity/pi-computer-use')) {
    return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: false, reason: `${PI_FALLBACK_BROWSER_PROVIDER} is not installed` };
  }

  let config;
  try {
    config = resolveComputerUseConfig({ projectRoot, env, home });
  } catch (error) {
    return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: false, reason: error.message };
  }
  if (config.browser_use !== true) {
    return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: false, reason: 'pi-computer-use browser_use must be true' };
  }
  if (config.headless !== true) {
    return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: false, reason: 'pi-computer-use headless must be true' };
  }
  return { provider: PI_FALLBACK_BROWSER_PROVIDER, ready: true, fallback: true };
}

export function resolveComputerUseConfig({ projectRoot = process.cwd(), env = process.env, home = homedir() } = {}) {
  const resolved = { browser_use: true, headless: false };
  for (const file of [
    join(home, '.pi', 'agent', 'extensions', 'pi-computer-use.json'),
    join(projectRoot, '.pi', 'computer-use.json'),
  ]) {
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`invalid pi-computer-use config ${file}: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`invalid pi-computer-use config ${file}: expected a JSON object`);
    }
    if (typeof parsed.browser_use === 'boolean') resolved.browser_use = parsed.browser_use;
    if (typeof parsed.headless === 'boolean') resolved.headless = parsed.headless;
  }

  if (env.PI_COMPUTER_USE_BROWSER_USE !== undefined) {
    resolved.browser_use = parseBooleanEnvironment('PI_COMPUTER_USE_BROWSER_USE', env.PI_COMPUTER_USE_BROWSER_USE);
  }
  if (env.PI_COMPUTER_USE_HEADLESS !== undefined) {
    resolved.headless = parseBooleanEnvironment('PI_COMPUTER_USE_HEADLESS', env.PI_COMPUTER_USE_HEADLESS);
  }
  return resolved;
}

function parseBooleanEnvironment(name, value) {
  if (value === '1') return true;
  if (value === '0') return false;
  throw new Error(`${name} must be 0 or 1`);
}
