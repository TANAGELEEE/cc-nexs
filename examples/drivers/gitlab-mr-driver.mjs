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
// Environment: GITLAB_TOKEN (api scope; needed only to find or create an MR through
// the API), GITLAB_API_URL (default https://<remote host>/api/v4), GITLAB_PROJECT
// (project path override when the remote URL is not a GitLab URL).
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--repo' && value?.includes('=')) { const [id, path] = value.split(/=(.*)/s); repos[id] = path; index += 1; }
    else if (argv[index] === '--title' && value) { title = value; index += 1; }
    else fail(`unknown argument: ${argv[index]}`);
  }
  return { repos, title };
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
  const { repos, title } = parseArgs(process.argv.slice(2));
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
  if (!process.env.GITLAB_TOKEN) fail('pushed the candidate but the server printed no merge request URL; set GITLAB_TOKEN so it can be found or created');
  // Push options were not honored (older server or option disabled): use the API.
  const open = (await api(apiBase, 'GET', query('opened')))[0]
    || await api(apiBase, 'POST', `${project}/merge_requests`, { source_branch: request.sourceBranch, target_branch: request.targetBranch, title: mrTitle, remove_source_branch: true });
  console.log(JSON.stringify({ status: 'pending', url: open.web_url }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.message));
}
