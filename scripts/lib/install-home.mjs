import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function parseInstallArgs(argv = []) {
  const positional = [];
  const flags = new Set();
  let home;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--home') {
      home = argv[index + 1];
      if (!home || home.startsWith('--')) throw new Error('--home requires a path');
      index += 1;
    } else if (arg.startsWith('--home=')) {
      home = arg.slice('--home='.length);
      if (!home) throw new Error('--home requires a path');
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags, home };
}

export function resolveInstallHome({ explicitHome, env = process.env, defaultHome = homedir() } = {}) {
  const selected = explicitHome || env.CC_NEXS_INSTALL_HOME || defaultHome;
  if (typeof selected !== 'string' || selected.trim() === '') {
    throw new Error('unable to resolve install home');
  }
  return resolve(selected);
}
