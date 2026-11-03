#!/usr/bin/env node
// Reference `release.base.driver` for GitLab (cc-nexs >= 0.11.0).
//
// The controller sends {operation: "ensure_merge_request", repository, sourceBranch,
// sourceCommit, targetBranch, targetBefore} on stdin. This driver pushes the exact
// candidate to the feature branch with GitLab merge request push options, or finds
// and creates the MR through the API when the branch already sits at the candidate
// (GitLab ignores push options on an unchanged ref). It never force-pushes, merges,
// squashes, or rebases. Output: {"status": "pending" | "merged", "url": "..."}.
//
//   node gitlab-mr-driver.mjs --repo web=web --repo api=services/api [--title "Merge {branch}"]
//
// Environment: GITLAB_TOKEN (api scope; optional, used only to find or create an MR
// through the API), GITLAB_API_URL (default https://<remote host>/api/v4),
// GITLAB_PROJECT (project path override when the remote URL is not a GitLab URL).
// Without a token the normal path still works through push options; for the rare
// MR they cannot create, pass --receipts <dir> and record the URL found in a
// signed-in browser with `record-mr` (the failure message prints the command).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIELDS = ['operation', 'repository', 'sourceBranch', 'sourceCommit', 'targetBranch', 'targetBefore'];
const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const repos = {};
  let title = 'Merge {branch}';
  let receipts = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--repo' && value?.includes('=')) { const [id, path] = value.split(/=(.*)/s); repos[id] = path; index += 1; }
    else if (argv[index] === '--title' && value) { title = value; index += 1; }
    else if (argv[index] === '--receipts' && value) { receipts = value; index += 1; }
    else fail(`unknown argument: ${argv[index]}`);
  }
  return { repos, title, receipts };
}

async function readRequest() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  if (Object.keys(request).sort().join() !== [...FIELDS].sort().join()) fail('unexpected request fields');
  if (request.operation !== 'ensure_merge_request') fail(`unsupported operation: ${request.operation}`);
  if (!SHA.test(request.sourceCommit) || !SHA.test(request.targetBefore)) fail('invalid commit in request');
  for (const branch of [request.sourceBranch, request.targetBranch]) {
    if (!BRANCH.test(branch) || branch.includes('..')) fail(`invalid branch: ${branch}`);
  }
  return request;
}

// https://host/group/project(.git), ssh://user@host[:port]/group/project(.git), user@host:group/project(.git)
export function gitlabProject(remote) {
  const match = remote.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?)([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
    || remote.match(/^[^@\s]+@([^:]+):(.+?)(?:\.git)?\/?$/);
  return match ? { host: match[1], path: match[2] } : null;
}

// Without an API token, the one MR that push options could not create or
// report is found or opened in a signed-in browser and its URL recorded here.
function mrReceiptFile(root, repository, branch) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository)) fail(`unsafe repository id: ${repository}`);
  return join(resolve(process.cwd(), root), repository, `${encodeURIComponent(branch)}.json`);
}

function recordedMergeRequest({ receipts, request }) {
  if (!receipts) return null;
  const file = mrReceiptFile(receipts, request.repository, request.sourceBranch);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (record.sourceCommit !== request.sourceCommit || record.targetBranch !== request.targetBranch) return null;
  return record.url;
}

function browserFallback({ receipts, request, why }) {
  const script = relative(process.cwd(), process.argv[1]) || process.argv[1];
  const recorded = recordedMergeRequest({ receipts, request });
  if (recorded) return recorded;
  fail(`${why}. Find or open the merge request ${request.sourceBranch} -> ${request.targetBranch} in the signed-in GitLab page, then run: node ${script} record-mr --receipts ${receipts || '<dir>'} --repository ${request.repository} --source-branch ${request.sourceBranch} --source-commit ${request.sourceCommit} --target-branch ${request.targetBranch} --url <merge request URL>; rerun release-base afterwards`);
}

function recordMergeRequest(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) fail(`invalid record-mr argument: ${argv[index]}`);
    values[argv[index].slice(2)] = argv[index + 1];
  }
  for (const field of ['receipts', 'repository', 'source-branch', 'source-commit', 'target-branch', 'url']) {
    if (!values[field]?.trim()) fail(`record-mr requires --${field}`);
  }
  if (!SHA.test(values['source-commit'])) fail('--source-commit must be the full candidate commit');
  if (!/^https?:\/\/\S+\/-\/merge_requests\/\d+$/.test(values.url)) fail('--url must be the merge request page');
  const file = mrReceiptFile(values.receipts, values.repository, values['source-branch']);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ sourceBranch: values['source-branch'], sourceCommit: values['source-commit'], targetBranch: values['target-branch'], url: values.url, recorded_at: new Date().toISOString() }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  console.log(JSON.stringify({ recorded: values.url, file }));
}

async function api(base, method, path, body) {
  const token = process.env.GITLAB_TOKEN;
  if (!token) fail('GITLAB_TOKEN is required to find or create the merge request through the API');
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'PRIVATE-TOKEN': token, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!response.ok) fail(`GitLab API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main() {
  if (process.argv[2] === 'record-mr') return recordMergeRequest(process.argv.slice(3));
  const { repos, title, receipts } = parseArgs(process.argv.slice(2));
  const request = await readRequest();
  if (!repos[request.repository]) fail(`no --repo mapping for ${request.repository}`);
  const repo = resolve(process.cwd(), repos[request.repository]);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const isAncestor = (ancestor, descendant) => spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
  const remote = gitlabProject(git('remote', 'get-url', '--push', 'origin'));
  const projectPath = process.env.GITLAB_PROJECT || remote?.path;
  const apiBase = (process.env.GITLAB_API_URL || (remote && `https://${remote.host}/api/v4`) || '').replace(/\/$/, '');
  if (!projectPath || !apiBase) fail('cannot derive the GitLab project from origin; set GITLAB_PROJECT and GITLAB_API_URL');
  const project = `/projects/${encodeURIComponent(projectPath)}`;
  const query = (state) => `${project}/merge_requests?source_branch=${encodeURIComponent(request.sourceBranch)}&target_branch=${encodeURIComponent(request.targetBranch)}&state=${state}`;
  const mrTitle = title.replaceAll('{branch}', request.sourceBranch);
  const listUrl = `${apiBase.replace(/\/api\/v4$/, '')}/${projectPath}/-/merge_requests?source_branch=${encodeURIComponent(request.sourceBranch)}`;

  git('fetch', '--quiet', 'origin', `+refs/heads/${request.targetBranch}:refs/remotes/origin/${request.targetBranch}`);
  if (isAncestor(request.sourceCommit, `refs/remotes/origin/${request.targetBranch}`)) {
    const merged = process.env.GITLAB_TOKEN ? (await api(apiBase, 'GET', query('merged')))[0] : null;
    console.log(JSON.stringify({ status: 'merged', url: merged?.web_url || listUrl }));
    return;
  }
  const current = git('ls-remote', '--heads', 'origin', `refs/heads/${request.sourceBranch}`).split(/\s+/)[0] || '';
  if (current === request.sourceCommit) {
    if (!process.env.GITLAB_TOKEN) {
      console.log(JSON.stringify({ status: 'pending', url: browserFallback({ receipts, request, why: `origin/${request.sourceBranch} already holds the candidate, so push options cannot create the merge request` }) }));
      return;
    }
    const open = (await api(apiBase, 'GET', query('opened')))[0]
      || await api(apiBase, 'POST', `${project}/merge_requests`, { source_branch: request.sourceBranch, target_branch: request.targetBranch, title: mrTitle, remove_source_branch: true });
    console.log(JSON.stringify({ status: 'pending', url: open.web_url }));
    return;
  }
  if (current) {
    git('fetch', '--quiet', 'origin', `+refs/heads/${request.sourceBranch}:refs/remotes/origin/${request.sourceBranch}`);
    if (!isAncestor(current, request.sourceCommit)) fail(`origin/${request.sourceBranch} has diverged from the candidate; reconcile it, never force-push`);
  }
  const push = spawnSync('git', ['-C', repo, 'push', 'origin', `${request.sourceCommit}:refs/heads/${request.sourceBranch}`,
    '-o', 'merge_request.create', '-o', `merge_request.target=${request.targetBranch}`,
    '-o', 'merge_request.remove_source_branch', '-o', `merge_request.title=${mrTitle}`], { encoding: 'utf8' });
  if (push.status !== 0) fail(`push failed: ${push.stderr.trim()}`);
  const printed = `${push.stdout}\n${push.stderr}`.match(/https?:\/\/\S+\/-\/merge_requests\/\d+/);
  if (printed) { console.log(JSON.stringify({ status: 'pending', url: printed[0] })); return; }
  if (!process.env.GITLAB_TOKEN) {
    console.log(JSON.stringify({ status: 'pending', url: browserFallback({ receipts, request, why: 'pushed the candidate but the server printed no merge request URL' }) }));
    return;
  }
  // Push options were not honored (older server or option disabled): use the API.
  const open = (await api(apiBase, 'GET', query('opened')))[0]
    || await api(apiBase, 'POST', `${project}/merge_requests`, { source_branch: request.sourceBranch, target_branch: request.targetBranch, title: mrTitle, remove_source_branch: true });
  console.log(JSON.stringify({ status: 'pending', url: open.web_url }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.message));
}
