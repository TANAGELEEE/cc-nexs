#!/usr/bin/env node
// Reference `release.test.driver` for GitLab CI (cc-nexs >= 0.8.0).
//
// The controller pushes the Test integration itself and then calls this driver
// with operation `release_test` (start) or `release_test_status` (resume). The
// driver reads pipelines through the GitLab API instead of a browser:
//   - no pipeline yet for the integration commit -> awaiting_receipt (resume later)
//   - pipeline running                           -> pending with its id and URL
//   - every deploy job in the pipeline and its child pipelines succeeded
//                                                 -> succeeded with jobs and revision
//   - a deploy or gate job is manual               -> pending (a person still has to run it)
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
// A missing GITLAB_TOKEN or an unreachable API returns awaiting_receipt, so the
// attempt is kept and resumed once the receipt can be read.
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

// Missing credentials or an unreachable API mean the receipt is unavailable,
// not that CI failed: the controller keeps the attempt and resumes it later.
class ReceiptUnavailable extends Error {}

async function api(context, method, path) {
  if (!process.env.GITLAB_TOKEN) throw new ReceiptUnavailable('GITLAB_TOKEN is not set; store it and run release-test --resume');
  let response;
  try {
    response = await fetch(`${context.apiBase}${context.project}${path}`, { method, headers: { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN } });
  } catch (error) {
    throw new ReceiptUnavailable(`GitLab API ${method} ${path} unreachable: ${error.message}`);
  }
  if (!response.ok) throw new ReceiptUnavailable(`GitLab API ${method} ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
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

// Jobs of a pipeline and of the child pipelines its trigger jobs started.
async function pipelineJobs(context, pipelineId, depth = 0) {
  const jobs = (await api(context, 'GET', `/pipelines/${pipelineId}/jobs?per_page=100`)).map((job) => ({ ...job, pipeline_id: pipelineId }));
  if (depth >= 3) return jobs;
  for (const bridge of await api(context, 'GET', `/pipelines/${pipelineId}/bridges?per_page=100`)) {
    if (bridge.downstream_pipeline?.id) jobs.push(...await pipelineJobs(context, bridge.downstream_pipeline.id, depth + 1));
  }
  return jobs;
}

// Every deploy job in the pipeline tree must succeed; a manual or unfinished
// one means the deployment is still waiting, typically for a person.
async function deploymentState(context, pipelineId, pattern) {
  const deploys = (await pipelineJobs(context, pipelineId)).filter((job) => pattern.test(job.name));
  if (!deploys.length) return { state: 'failed', reason: `pipeline ${pipelineId} has no deploy job matching ${pattern}` };
  const record = (job) => ({ id: String(job.id), name: job.name, url: job.web_url, pipeline: String(job.pipeline_id) });
  if (deploys.every((job) => job.status === 'success')) return { state: 'succeeded', jobs: deploys.map(record) };
  const waiting = deploys.filter((job) => ['manual', 'created', 'pending', 'running', 'waiting_for_resource', 'preparing', 'scheduled'].includes(job.status));
  if (waiting.length) return { state: 'pending', reason: `waiting for ${waiting.map((job) => `${job.name} (${job.status})`).join(', ')}` };
  return { state: 'failed', reason: `deploy job(s) ${deploys.filter((job) => job.status !== 'success').map((job) => `${job.name} ${job.status}`).join(', ')}` };
}

async function inspect(context, integration, previousPipeline, options) {
  const sha = integration.integrationCommit;
  const ref = integration.targetBranch;
  const pipeline = previousPipeline?.id
    ? await api(context, 'GET', `/pipelines/${previousPipeline.id}`)
    : (await api(context, 'GET', `/pipelines?sha=${sha}&ref=${encodeURIComponent(ref)}&order_by=id&sort=desc`))[0];
  if (!pipeline) return { state: 'awaiting', reason: `no pipeline yet for ${context.id} ${sha.slice(0, 12)} on ${ref}` };
  const identity = { id: String(pipeline.id), url: pipeline.web_url };
  if (RUNNING.has(pipeline.status)) {
    if (options.playManual) {
      for (const job of await pipelineJobs(context, pipeline.id)) {
        if (job.status === 'manual' && options.playManual.test(job.name)) await api(context, 'POST', `/jobs/${job.id}/play`);
      }
    }
    const deployment = pipeline.status === 'manual' ? await deploymentState(context, pipeline.id, options.deployJob) : null;
    return { state: 'pending', pipeline: identity, ...(deployment?.reason && { reason: `${context.id}: ${deployment.reason}` }) };
  }
  if (pipeline.status === 'success') {
    const deployment = await deploymentState(context, pipeline.id, options.deployJob);
    if (deployment.state !== 'succeeded') return { ...deployment, pipeline: identity, reason: `${context.id}: ${deployment.reason}` };
    return { state: 'succeeded', pipeline: identity, jobs: deployment.jobs, revision: pipeline.sha };
  }
  if (pipeline.status === 'canceled') {
    // A later push to the shared Test branch cancels the older pipeline; accept the
    // newest successful pipeline whose commit contains this integration.
    spawnSync('git', ['-C', context.repo, 'fetch', '--quiet', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
    for (const later of await api(context, 'GET', `/pipelines?ref=${encodeURIComponent(ref)}&status=success&order_by=id&sort=desc&per_page=20`)) {
      if (later.id <= pipeline.id) break;
      if (spawnSync('git', ['-C', context.repo, 'merge-base', '--is-ancestor', sha, later.sha]).status !== 0) continue;
      const deployment = await deploymentState(context, later.id, options.deployJob);
      if (deployment.state === 'succeeded') return { state: 'succeeded', pipeline: identity, jobs: deployment.jobs, revision: later.sha, superseded: true };
    }
    return { state: 'pending', pipeline: identity, reason: `${context.id}: pipeline ${pipeline.id} was canceled; waiting for a later Test pipeline that contains ${sha.slice(0, 12)}` };
  }
  return { state: 'failed', pipeline: identity, reason: `${context.id}: pipeline ${pipeline.id} ${pipeline.status}` };
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
    deployment: { environment: payload.environment || 'test', jobs: Object.fromEntries(Object.entries(results).map(([id, item]) => [id, item.jobs])) },
    environment_revision: Object.fromEntries(Object.entries(results).map(([id, item]) => [id, item.revision])),
  });
}

function print(result) {
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof ReceiptUnavailable) print({ status: 'awaiting_receipt', reason: error.message });
    else fail(error.message);
  });
}
