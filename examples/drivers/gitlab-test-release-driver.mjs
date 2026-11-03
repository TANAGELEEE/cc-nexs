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
//   node gitlab-test-release-driver.mjs --receipts .cc-nexs/runtime/tasks
//     (no API token: read receipts recorded from a signed-in browser with
//      `record-receipt`; the awaiting_receipt reason prints the exact command)
//
// --play-manual plays matching manual jobs of this pipeline once; use it only
// where your team allows automation to pass that gate in Test.
// A missing GITLAB_TOKEN or an unreachable API returns awaiting_receipt, so the
// attempt is kept and resumed once the receipt can be read.
// Environment: GITLAB_TOKEN (read_api; api when --play-manual is used),
// GITLAB_API_URL (default https://<remote host>/api/v4), GITLAB_PROJECT (override).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitlabProject } from './gitlab-mr-driver.mjs';

const RUNNING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'manual']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { repos: {}, deployJob: /deploy|release/i, playManual: null, receipts: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--repo' && value?.includes('=')) { const [id, path] = value.split(/=(.*)/s); options.repos[id] = path; }
    else if (argv[index] === '--deploy-job' && value) options.deployJob = new RegExp(value, 'i');
    else if (argv[index] === '--play-manual' && value) options.playManual = new RegExp(value);
    else if (argv[index] === '--receipts' && value) options.receipts = value;
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

// Browser receipts: where API tokens are not allowed, a person or the
// Orchestrator reads the pipeline in a signed-in browser (the GitLab pipeline
// page or an operations publication page) and records only what it saw. The
// driver turns that record into the controller's evidence; the controller still
// proves the deployed revision contains the integration through Git ancestry.
const RECEIPT_STATUSES = new Set(['pending', 'succeeded', 'failed']);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function receiptFile(root, featureId, attempt) {
  if (!SAFE_SEGMENT.test(String(featureId)) || !SAFE_SEGMENT.test(String(attempt))) fail('unsafe feature or attempt id');
  return join(resolve(process.cwd(), root), String(featureId), 'release', `${attempt}.json`);
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

function browserInspect({ payload, options }) {
  const file = receiptFile(options.receipts, payload.feature?.id, payload.attempt);
  const request = {
    feature: payload.feature, attempt: payload.attempt, environment: payload.environment || 'test',
    integrations: Object.fromEntries(Object.entries(payload.integrations).map(([id, item]) => [id, { integrationCommit: item.integrationCommit, targetBranch: item.targetBranch }])),
  };
  const record = readJson(file) || { request, repositories: {} };
  if (JSON.stringify(record.request) !== JSON.stringify(request)) fail(`receipt ${file} belongs to another integration; it is never reused`);
  writeJson(file, record);
  const script = relative(process.cwd(), process.argv[1]) || process.argv[1];
  const results = {};
  for (const [id, integration] of Object.entries(request.integrations)) {
    const seen = record.repositories[id];
    const sha = integration.integrationCommit;
    if (!seen) {
      results[id] = { state: 'awaiting', reason: `${id}: open the Test pipeline for ${sha.slice(0, 12)} on ${integration.targetBranch} in the signed-in browser (GitLab pipeline page or the operations publication page), then record what you saw: node ${script} record-receipt --receipts ${options.receipts} --feature ${payload.feature.id} --attempt ${payload.attempt} --repo ${id} --status pending|succeeded|failed --pipeline-id <id> --pipeline-url <url> [--revision <deployed commit> --deploy-job <job>] --observed-via "<page>"` };
      continue;
    }
    const pipeline = { id: seen.pipeline.id, url: seen.pipeline.url };
    if (seen.status === 'pending') results[id] = { state: 'pending', pipeline, reason: `${id}: ${seen.note || `pipeline ${seen.pipeline.id} still running or waiting for a manual job`} (observed via ${seen.observed_via})` };
    else if (seen.status === 'failed') results[id] = { state: 'failed', pipeline, reason: `${id}: pipeline ${seen.pipeline.id} observed failed via ${seen.observed_via}${seen.note ? `: ${seen.note}` : ''}` };
    else results[id] = { state: 'succeeded', pipeline, revision: seen.revision, jobs: [{ name: seen.deploy_job, pipeline: seen.deploy_pipeline || seen.pipeline.id, observed_via: seen.observed_via, observed_at: seen.observed_at }] };
  }
  return results;
}

function recordReceipt(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) fail(`invalid record-receipt argument: ${argv[index]}`);
    values[argv[index].slice(2)] = argv[index + 1];
  }
  for (const field of ['receipts', 'feature', 'attempt', 'repo', 'status', 'pipeline-id', 'pipeline-url', 'observed-via']) {
    if (!values[field]?.trim()) fail(`record-receipt requires --${field}`);
  }
  if (!RECEIPT_STATUSES.has(values.status)) fail('--status must be pending, succeeded, or failed');
  if (!/^https?:\/\//.test(values['pipeline-url'])) fail('--pipeline-url must be the page that was observed');
  if (values.status === 'succeeded') {
    if (!/^[0-9a-f]{7,40}$/i.test(values.revision || '')) fail('a succeeded receipt requires --revision with the deployed commit (7-40 hex)');
    if (!values['deploy-job']?.trim()) fail('a succeeded receipt requires --deploy-job naming the deploy job or publication record');
  }
  const file = receiptFile(values.receipts, values.feature, values.attempt);
  const record = readJson(file);
  if (!record) fail(`no receipt request for ${values.feature} ${values.attempt}; run release-test first`);
  if (!record.request.integrations[values.repo]) fail(`${values.repo} is not part of attempt ${values.attempt}`);
  const previous = record.repositories[values.repo];
  if (previous && previous.pipeline.id !== values['pipeline-id']) {
    fail(`pipeline already recorded as ${previous.pipeline.id}; record a later pipeline that deployed this integration with --deploy-pipeline`);
  }
  record.repositories[values.repo] = {
    status: values.status,
    pipeline: { id: values['pipeline-id'], url: values['pipeline-url'] },
    ...(values.revision && { revision: values.revision.toLowerCase() }),
    ...(values['deploy-job'] && { deploy_job: values['deploy-job'] }),
    ...(values['deploy-pipeline'] && { deploy_pipeline: values['deploy-pipeline'] }),
    ...(values.note && { note: values.note }),
    observed_via: values['observed-via'],
    observed_at: new Date().toISOString(),
  };
  writeJson(file, record);
  print({ recorded: values.repo, status: values.status, file });
}

async function main() {
  if (process.argv[2] === 'record-receipt') return recordReceipt(process.argv.slice(3));
  const options = parseArgs(process.argv.slice(2));
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const payload = JSON.parse(text);
  if (!['release_test', 'release_test_status'].includes(payload.operation)) fail(`unsupported operation: ${payload.operation}`);
  const entries = Object.entries(payload.integrations || {});
  if (!entries.length) fail('no Test integrations in the request');
  for (const [id, integration] of entries) {
    if (!/^[0-9a-f]{40}$/.test(integration?.integrationCommit || '')) fail(`integration commit for ${id} is missing`);
  }
  let results = {};
  if (options.receipts) results = browserInspect({ payload, options });
  else {
    for (const [id, integration] of entries) {
      if (!options.repos[id]) fail(`no --repo mapping for ${id}`);
      results[id] = await inspect(repositoryContext(id, options.repos[id]), integration, payload.previous?.pipeline?.[id], options);
    }
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
