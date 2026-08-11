#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';
import { hasLegacyTemplateRoleMap, normalizeRiskTier, validateModelRoutingConfig } from './model-routing.mjs';
import { inspectPlanRiskBinding } from './plan-contract.mjs';
import {
  inspectPiBrowserCapability,
  PI_FALLBACK_BROWSER_PROVIDER,
  PI_PRIMARY_BROWSER_PROVIDER,
} from './pi-browser-provider.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const args = process.argv.slice(2);
const strictRelease = args.includes('--release-test');
const featureFilter = optionValue(args, '--feature');
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--feature') { index += 1; continue; }
  if (arg.startsWith('--feature=') || arg === '--release-test') continue;
  if (!arg.startsWith('-')) positional.push(arg);
}
const root = resolve(positional[0] || process.cwd());
const errors = [];
const warnings = [];
let workspace = null;
let config = null;
try { workspace = loadWorkspaceConfig({ projectRoot: root }); } catch (error) { errors.push(error.message); }
try {
  const pluginRoot = [
    process.env.CC_NEXS_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.PLUGIN_ROOT,
  ].find((candidate) => candidate && existsSync(join(candidate, 'preset.yml')));
  config = loadConfig({ projectRoot: root, ...(pluginRoot && { presetRoot: pluginRoot }) });
} catch (error) { errors.push(error.message); }

if (!workspace) warnings.push('workspace config not found; single-repository mode only');
else {
  for (const repo of workspace.repositories) {
    if (!existsSync(repo.absolute_path)) {
      errors.push(`repository path missing: ${repo.id}`);
      continue;
    }
    try { execFileSync('git', ['-C', repo.absolute_path, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); }
    catch { errors.push(`not a git repository: ${repo.id}`); }
  }
}

if (config) validateReleaseReadiness({ config, workspace, strictRelease, errors, warnings, projectRoot: root });

function findProgressFiles(dir, depth = 0) {
  if (!existsSync(dir) || depth > 5) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findProgressFiles(target, depth + 1));
    else if (entry.isFile() && entry.name === 'progress.json') files.push(target);
  }
  return files;
}

const docsSource = workspace?.repositories.find((repo) => repo.id === workspace.docs_repository)?.absolute_path || join(root, 'all-docs');
const progressFiles = new Set([
  ...findProgressFiles(join(docsSource, 'doc')),
  ...(workspace ? findProgressFiles(workspace.worktree_root) : []),
]);
const selectedProgressFiles = featureFilter
  ? [...progressFiles].filter((file) => matchesFeature(dirname(file), featureFilter))
  : [...progressFiles];
if (featureFilter && selectedProgressFiles.length === 0) {
  errors.push(`feature ${featureFilter}: progress.json not found`);
}
for (const file of selectedProgressFiles) {
    const featureDir = dirname(file);
    const featureName = basename(featureDir);
    const activeWorktreeState = workspace && resolve(file).startsWith(`${resolve(workspace.worktree_root)}${process.platform === 'win32' ? '\\' : '/'}`);
    try {
      const progress = readProgressV2(file);
      const featureConfig = join(featureDir, 'config.json');
      if (existsSync(featureConfig)) {
        const feature = JSON.parse(readFileSync(featureConfig, 'utf8'));
        const configuredMode = feature.mode || 'lean';
        if (configuredMode !== progress.mode) errors.push(`${featureName}: config mode ${configuredMode} != progress mode ${progress.mode}`);
        if (['lean', 'hotfix'].includes(configuredMode)) {
          if (feature.config_version !== 2) {
            if (feature.config_version === undefined || feature.config_version === 1) {
              warnings.push(`${featureName}: legacy config; run /cc-nexs:migrate-feature-config ${progress.feature.id}`);
            } else {
              errors.push(`${featureName}: unsupported config_version ${feature.config_version}`);
            }
          }
          try {
            const riskTier = normalizeRiskTier(feature.risk_tier);
            if (feature.config_version === 2 && feature.risk_tier !== riskTier) {
              errors.push(`${featureName}: risk_tier must use canonical auto|low|medium|high|critical`);
            }
          } catch (error) {
            errors.push(`${featureName}: ${error.message}`);
          }
          if (hasLegacyTemplateRoleMap(feature, configuredMode)) {
            warnings.push(`${featureName}: generated models.roles blocks project routing; run /cc-nexs:migrate-feature-config ${progress.feature.id}`);
          }
          try { validateModelRoutingConfig(feature.models?.routing); }
          catch (error) { errors.push(`${featureName}: ${error.message}`); }
        }
      }
      if (progress.mode === 'lean' && progress.gates?.plan?.approved === true) {
        try {
          const planRisk = inspectPlanRiskBinding(progress, featureDir);
          if (planRisk.status === 'derivable') {
            warnings.push(`${featureName}: legacy Gateway A risk ${planRisk.risk_tier} is hash-verified; run /cc-nexs:migrate-feature-config ${progress.feature.id} --bind-plan-risk to materialize it`);
          } else if (planRisk.status === 'unstructured') {
            warnings.push(`${featureName}: legacy Gateway A has no concrete risk_tier; routing uses conservative high until the plan is revised and re-approved`);
          }
        } catch (error) {
          errors.push(`${featureName}: ${error.message}`);
        }
      }
      for (const [repoId, assignment] of Object.entries(progress.repositories || {})) {
        const repo = workspace?.repositories.find((item) => item.id === repoId);
        if (!repo) { errors.push(`${featureName}: unknown assigned repository ${repoId}`); continue; }
        // Merged docs intentionally retain their historical assignments after
        // finalize removes runtime worktrees. Only active state under
        // worktree_root must still resolve to a live worktree and branch.
        if (!activeWorktreeState) continue;
        if (assignment.base_branch && assignment.base_branch !== repo.base_branch) {
          errors.push(`${featureName}: configured base ${repo.base_branch} != assigned base ${assignment.base_branch} for ${repoId}`);
        }
        const assignedWorktree = assignment.worktree ? resolve(root, assignment.worktree) : null;
        if (!assignedWorktree || !existsSync(assignedWorktree)) {
          errors.push(`${featureName}: assigned worktree missing for ${repoId}`);
          continue;
        }
        const branch = execFileSync('git', ['-C', assignedWorktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
        if (branch !== assignment.branch) errors.push(`${featureName}: branch mismatch for ${repoId}`);
      }
    } catch (error) { errors.push(`${featureName}: ${error.message}`); }
}

function optionValue(values, name) {
  const inline = values.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || null;
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] || null : null;
}

function matchesFeature(featureDir, requested) {
  const name = basename(featureDir);
  const actualId = name.match(/^(\d+)(?:[.\-_]|$)/)?.[1] || name;
  if (/^\d+$/.test(actualId) && /^\d+$/.test(requested)) {
    return Number(actualId) === Number(requested);
  }
  return actualId === requested || name === requested;
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
else console.log(`cc-nexs doctor passed (${workspace?.repositories.length || 1} repository configuration).`);

function validateReleaseReadiness({ config, workspace, strictRelease, errors, warnings, projectRoot }) {
  const policy = config.mergedWorkflow?.test_release?.policy;
  if (policy !== 'auto_if_ready' && !strictRelease) return;
  const report = (message) => (strictRelease ? errors : warnings).push(message);
  const verificationWarning = (message) => warnings.push(message);
  if (['lean', 'hotfix'].includes(config.mergedWorkflow?.default_mode) && !config.mergedWorkflow?.local_verify?.driver?.command) {
    verificationWarning(config.mergedWorkflow.default_mode === 'lean'
      ? 'workflow.local_verify.driver.command is not configured; Lean must run plan-approved commands and record structured exact-candidate evidence'
      : 'hotfix mode requires workflow.local_verify.driver.command before local verification');
  }
  if (!workspace) {
    report('automatic test release requires .cc-nexs/workspace.yml or workspace.json');
    return;
  }
  const codeRepositories = workspace.repositories.filter((repo) => repo.id !== workspace.docs_repository && repo.docs !== true);
  if (codeRepositories.length === 0) report('automatic test release requires at least one code repository');
  for (const repo of codeRepositories) {
    if (!repo.test_branch) {
      verificationWarning(`repository ${repo.id} has no test_branch; Lean may use it locally only with an approved test_delivery.${repo.id}: local binding`);
    }
  }
  if (codeRepositories.length > 0 && !codeRepositories.some((repo) => repo.test_branch)) {
    report('automatic test release requires at least one code repository with test_branch');
  }

  const release = config.mergedRelease?.test || {};
  if ((release.environment || 'test').toLowerCase() !== 'test') report('automatic release environment must be test');
  if (!release.driver?.command) report('release.test.driver.command is required for automatic test release');
  if (release.browser?.required !== false) {
    for (const field of ['claude_provider', 'codex_provider', 'pi_provider']) {
      if (!release.browser?.[field]) verificationWarning(`release.test.browser.${field} is required for automatic verification`);
    }
    if (release.browser?.pi_provider && release.browser.pi_provider !== PI_PRIMARY_BROWSER_PROVIDER) {
      verificationWarning(`release.test.browser.pi_provider must be ${PI_PRIMARY_BROWSER_PROVIDER} for automatic verification`);
    }
    if (release.browser?.pi_fallback?.provider !== PI_FALLBACK_BROWSER_PROVIDER) {
      verificationWarning(`release.test.browser.pi_fallback.provider must be ${PI_FALLBACK_BROWSER_PROVIDER} for automatic verification`);
    }
    if (release.browser?.pi_fallback?.headless !== true) {
      verificationWarning('release.test.browser.pi_fallback.headless must be true for automatic verification');
    }
  }
  const allowed = new Set(release.allowed_hosts || []);
  for (const [name, value] of [['app_url', release.app_url], ['operations_url', release.operations_url]]) {
    if (!value) { verificationWarning(`release.test.${name} is required before automatic verification, not before test delivery`); continue; }
    let url;
    try { url = new URL(value); }
    catch { verificationWarning(`release.test.${name} is invalid for automatic verification: ${value}`); continue; }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      verificationWarning(`release.test.${name} must use https for automatic verification`);
    }
    if (!allowed.has(url.hostname)) verificationWarning(`${url.hostname} is missing from release.test.allowed_hosts for automatic verification`);
    if (/(^|[.-])(prod|production|live)([.-]|$)/i.test(url.hostname)) report(`production-like host is forbidden: ${url.hostname}`);
  }
  for (const finding of findPlaintextCredentialFields({ project: config.project, overlay: config.overlay })) {
    errors.push(`plaintext credential field is forbidden: ${finding}`);
  }

  if (process.env.CC_NEXS_RUNTIME === 'pi' && release.browser?.required !== false) {
    const capability = inspectPiBrowserCapability({ projectRoot });
    if (!capability.ready) verificationWarning(`Pi automatic browser verification is unavailable after delivery: ${capability.reason}`);
    else if (capability.fallback) warnings.push(`Pi browser verification will use ${PI_FALLBACK_BROWSER_PROVIDER} with headless=true because ${capability.primaryFailure}`);
  }
}

function findPlaintextCredentialFields(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (isSensitiveCredentialKey(key) && hasLiteralCredentialValue(child)) findings.push(next);
    findings.push(...findPlaintextCredentialFields(child, next));
  }
  return findings;
}

function isSensitiveCredentialKey(key) {
  return /^(?:password|passwd|credential|credentials|secret_value|token|api_?key|secret|client_secret|access_key_id|secret_access_key|aws_access_key_id|aws_secret_access_key|private_key)$/i.test(key)
    && !/(?:_ref|_env|_file|_path)$/i.test(key);
}

function hasLiteralCredentialValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return false;
  return value !== undefined && value !== null && value !== '' && value !== false;
}
