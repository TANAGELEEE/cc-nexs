#!/usr/bin/env node
// Reference `release.test.driver` for GitLab CI (cc-nexs >= 0.8.0).
//
// The controller pushes the Test integration itself and then calls this driver
// with operation `release_test` (start) or `release_test_status` (resume). The
// driver reads pipelines through the GitLab API instead of a browser:
//   - no pipeline yet for the integration commit -> awaiting_receipt (resume later)
//   - pipeline running                           -> pending with its id and URL
//   - pipeline succeeded with a deploy job        -> succeeded with job and revision
//   - pipeline canceled because a later push to the same Test branch superseded
//     it -> succeeded from the later successful pipeline whose commit contains the
//     integration (the controller verifies that ancestry itself)
//   - pipeline failed                             -> failed with the reason
//
//   node gitlab-test-release-driver.mjs --repo web=web [--repo api=services/api]
//     [--deploy-job "deploy|release"] [--play-manual "^qa-gate$"]
//
// --play-manual plays matching manual jobs of this pipeline once; use it only
// where your team allows automation to pass that gate in Test.
// Environment: GITLAB_TOKEN (read_api; api when --play-manual is used),
// GITLAB_API_URL (default https://<remote host>/api/v4), GITLAB_PROJECT (override).
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitlabProject } from './gitlab-mr-driver.mjs';

const RUNNING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'manual']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { repos: {}, deployJob: /deploy|release/i, playManual: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--repo' && value?.includes('=')) { const [id, path] = value.split(/=(.*)/s); options.repos[id] = path; }
    else if (argv[index] === '--deploy-job' && value) options.deployJob = new RegExp(value, 'i');
    else if (argv[index] === '--play-manual' && value) options.playManual = new RegExp(value);
    else fail(`unknown argument: ${argv[index]}`);
    index += 1;
  }
  return options;
}

async function api(context, method, path) {
  if (!process.env.GITLAB_TOKEN) fail('GITLAB_TOKEN is required to read pipelines');
  const response = await fetch(`${context.apiBase}${context.project}${path}`, { method, headers: { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN } });
  if (!response.ok) fail(`GitLab API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function repositoryContext(id, path) {
  const repo = resolve(process.cwd(), path);
  const remoteUrl = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const remote = gitlabProject(remoteUrl);
  const projectPath = process.env.GITLAB_PROJECT || remote?.path;
  const apiBase = (process.env.GITLAB_API_URL || (remote && `https://${remote.host}/api/v4`) || '').replace(/\/$/, '');
  if (!projectPath || !apiBase) fail(`cannot derive the GitLab project for ${id}; set GITLAB_PROJECT and GITLAB_API_URL`);
  return { id, repo, apiBase, project: `/projects/${encodeURIComponent(projectPath)}` };
}

async function deployJob(context, pipelineId, pattern) {
  const jobs = await api(context, 'GET', `/pipelines/${pipelineId}/jobs?per_page=100`);
  return jobs.find((job) => pattern.test(job.name) && job.status === 'success') || null;
}

async function inspect(context, integration, previousPipeline, options) {
  const sha = integration.integrationCommit;
  const ref = integration.targetBranch;
  let pipeline = previousPipeline?.id
    ? await api(context, 'GET', `/pipelines/${previousPipeline.id}`)
    : (await api(context, 'GET', `/pipelines?sha=${sha}&ref=${encodeURIComponent(ref)}&order_by=id&sort=desc`))[0];
  if (!pipeline) return { state: 'awaiting', reason: `no pipeline yet for ${context.id} ${sha.slice(0, 12)} on ${ref}` };
  const identity = { id: String(pipeline.id), url: pipeline.web_url };
  if (RUNNING.has(pipeline.status)) {
    if (options.playManual) {
      for (const job of await api(context, 'GET', `/pipelines/${pipeline.id}/jobs?per_page=100`)) {
        if (job.status === 'manual' && options.playManual.test(job.name)) await api(context, 'POST', `/jobs/${job.id}/play`);
      }
    }
    return { state: 'pending', pipeline: identity };
  }
  if (pipeline.status === 'success') {
    const job = await deployJob(context, pipeline.id, options.deployJob);
    if (!job) return { state: 'failed', pipeline: identity, reason: `pipeline ${pipeline.id} succeeded without a deploy job matching ${options.deployJob}` };
    return { state: 'succeeded', pipeline: identity, job: { id: String(job.id), url: job.web_url, pipeline: String(pipeline.id) }, revision: pipeline.sha };
  }
  if (pipeline.status === 'canceled') {
    // A later push to the shared Test branch cancels the older pipeline; accept the
    // newest successful pipeline whose commit contains this integration.
    spawnSync('git', ['-C', context.repo, 'fetch', '--quiet', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
    for (const later of await api(context, 'GET', `/pipelines?ref=${encodeURIComponent(ref)}&status=success&order_by=id&sort=desc&per_page=20`)) {
      if (later.id <= pipeline.id) break;
      if (spawnSync('git', ['-C', context.repo, 'merge-base', '--is-ancestor', sha, later.sha]).status !== 0) continue;
      const job = await deployJob(context, later.id, options.deployJob);
      if (job) return { state: 'succeeded', pipeline: identity, job: { id: String(job.id), url: job.web_url, pipeline: String(later.id) }, revision: later.sha, superseded: true };
    }
    return { state: 'pending', pipeline: identity, reason: `pipeline ${pipeline.id} was canceled; waiting for a later Test pipeline that contains ${sha.slice(0, 12)}` };
  }
  return { state: 'failed', pipeline: identity, reason: `pipeline ${pipeline.id} ${pipeline.status}` };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const payload = JSON.parse(text);
  if (!['release_test', 'release_test_status'].includes(payload.operation)) fail(`unsupported operation: ${payload.operation}`);
  const entries = Object.entries(payload.integrations || {});
  if (!entries.length) fail('no Test integrations in the request');
  const results = {};
  for (const [id, integration] of entries) {
    if (!options.repos[id]) fail(`no --repo mapping for ${id}`);
    if (!/^[0-9a-f]{40}$/.test(integration?.integrationCommit || '')) fail(`integration commit for ${id} is missing`);
    results[id] = await inspect(repositoryContext(id, options.repos[id]), integration, payload.previous?.pipeline?.[id], options);
  }
  const states = Object.values(results).map((item) => item.state);
  const pipeline = Object.fromEntries(Object.entries(results).filter(([, item]) => item.pipeline).map(([id, item]) => [id, item.pipeline]));
  const reason = Object.values(results).map((item) => item.reason).filter(Boolean).join('; ');
  // Keep the first recorded pipeline identity: the controller rejects a changed one.
  const stablePipeline = payload.previous?.pipeline || (Object.keys(pipeline).length ? pipeline : undefined);
  if (states.includes('failed')) return print({ status: 'failed', reason, ...(stablePipeline && { pipeline: stablePipeline }) });
  if (states.includes('awaiting')) return print({ status: 'awaiting_receipt', reason, ...(stablePipeline && { pipeline: stablePipeline }) });
  if (states.includes('pending')) return print({ status: 'pending', pipeline: stablePipeline, ...(reason && { reason }) });
  print({
    status: 'succeeded',
    pipeline: stablePipeline,
    deployment: { environment: payload.environment || 'test', jobs: Object.fromEntries(Object.entries(results).map(([id, item]) => [id, item.job])) },
    environment_revision: Object.fromEntries(Object.entries(results).map(([id, item]) => [id, item.revision])),
  });
}

function print(result) {
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.message));
}
