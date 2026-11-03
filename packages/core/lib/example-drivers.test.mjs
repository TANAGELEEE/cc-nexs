import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const drivers = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'drivers');
const roots = [];
const servers = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-driver-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const repo = join(root, 'api');
  git(root, ['init', '-q', '--bare', origin]);
  git(origin, ['config', 'receive.advertisePushOptions', 'true']);
  git(root, ['clone', '-q', origin, repo]);
  git(repo, ['config', 'user.name', 'Driver Test']);
  git(repo, ['config', 'user.email', 'driver@example.com']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  const commit = (name) => { writeFileSync(join(repo, name), `${name}\n`); git(repo, ['add', name]); git(repo, ['commit', '-q', '-m', name]); return git(repo, ['rev-parse', 'HEAD']); };
  commit('base.txt');
  git(repo, ['push', '-q', 'origin', 'main']);
  return { root, repo, commit };
}

// A tiny stand-in for the GitLab REST endpoints the reference drivers use.
async function fakeGitlab(handler) {
  const calls = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const url = new URL(request.url, 'http://localhost');
      calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null, token: request.headers['private-token'] });
      const result = handler(calls.at(-1));
      response.writeHead(result === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result ?? { message: 'not found' }));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return { calls, base: `http://127.0.0.1:${server.address().port}/api/v4` };
}

function run(script, args, input, { cwd, env }) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(drivers, script), ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => done({ code, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('reference MR driver pushes the exact candidate to the feature branch and finds or creates one MR', async () => {
  const { root, repo, commit } = repository();
  git(repo, ['checkout', '-q', '-b', 'feature/07-demo']);
  const source = commit('feature.txt');
  git(repo, ['checkout', '-q', 'main']);
  const mrs = [];
  const gitlab = await fakeGitlab((call) => {
    if (call.method === 'GET' && call.path === '/api/v4/projects/group%2Fapi/merge_requests') return mrs.filter((mr) => mr.state === call.query.state);
    if (call.method === 'POST' && call.path === '/api/v4/projects/group%2Fapi/merge_requests') {
      const mr = { state: 'opened', web_url: `https://gitlab.example.com/group/api/-/merge_requests/${mrs.length + 1}`, ...call.body };
      mrs.push(mr);
      return mr;
    }
    return undefined;
  });
  const options = { cwd: root, env: { GITLAB_API_URL: gitlab.base, GITLAB_PROJECT: 'group/api', GITLAB_TOKEN: 'test-token' } };
  const request = { operation: 'ensure_merge_request', repository: 'api', sourceBranch: 'feature/07-demo', sourceCommit: source, targetBranch: 'main', targetBefore: git(repo, ['rev-parse', 'origin/main']) };
  const first = await run('gitlab-mr-driver.mjs', ['--repo', 'api=api'], request, options);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.json, { status: 'pending', url: 'https://gitlab.example.com/group/api/-/merge_requests/1' });
  assert.equal(git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/feature/07-demo']).split(/\s+/)[0], source);
  assert.deepEqual(mrs[0], { state: 'opened', web_url: mrs[0].web_url, source_branch: 'feature/07-demo', target_branch: 'main', title: 'Merge feature/07-demo', remove_source_branch: true });
  assert.ok(gitlab.calls.every((call) => call.token === 'test-token'));

  const again = await run('gitlab-mr-driver.mjs', ['--repo', 'api=api'], request, options);
  assert.equal(again.json.url, first.json.url);
  assert.equal(mrs.length, 1);

  git(repo, ['merge', '-q', '--no-ff', '--no-edit', source]);
  git(repo, ['push', '-q', 'origin', 'main']);
  const merged = await run('gitlab-mr-driver.mjs', ['--repo', 'api=api'], request, options);
  assert.equal(merged.json.status, 'merged');

  git(repo, ['checkout', '-q', '-b', 'feature/08-demo', 'origin/main']);
  const next = commit('next.txt');
  git(repo, ['checkout', '-q', '-b', 'other', 'origin/main']);
  git(repo, ['push', '-q', 'origin', `${commit('diverged.txt')}:refs/heads/feature/08-demo`]);
  const diverged = await run('gitlab-mr-driver.mjs', ['--repo', 'api=api'], { ...request, sourceBranch: 'feature/08-demo', sourceCommit: next }, options);
  assert.equal(diverged.code, 1);
  assert.match(diverged.stderr, /diverged from the candidate; reconcile it, never force-push/);
});

test('reference Test release driver reports pipelines from the API and accepts a superseding pipeline', async () => {
  const { root, repo, commit } = repository();
  const integration = commit('integration.txt');
  const later = commit('later.txt');
  git(repo, ['push', '-q', 'origin', 'HEAD:refs/heads/test']);
  const pipelines = new Map();
  const jobs = new Map();
  const played = [];
  const gitlab = await fakeGitlab((call) => {
    const base = '/api/v4/projects/group%2Fapi';
    if (call.method === 'GET' && call.path === `${base}/pipelines`) {
      return [...pipelines.values()].filter((item) => (!call.query.sha || item.sha === call.query.sha) && (!call.query.status || item.status === call.query.status)).sort((a, b) => b.id - a.id);
    }
    const one = call.path.match(/\/pipelines\/(\d+)$/);
    if (one) return pipelines.get(Number(one[1]));
    const list = call.path.match(/\/pipelines\/(\d+)\/jobs$/);
    if (list) return jobs.get(Number(list[1])) || [];
    const play = call.path.match(/\/jobs\/(\d+)\/play$/);
    if (call.method === 'POST' && play) { played.push(Number(play[1])); return { id: Number(play[1]) }; }
    return undefined;
  });
  const options = { cwd: root, env: { GITLAB_API_URL: gitlab.base, GITLAB_PROJECT: 'group/api', GITLAB_TOKEN: 'test-token' } };
  const payload = (operation, previous = {}) => ({ schema_version: 1, operation, environment: 'test', attempt: 'test-release-1', integrations: { api: { sourceCommit: integration, targetBranch: 'test', integrationCommit: integration } }, previous });
  const args = ['--repo', 'api=api', '--deploy-job', '^deploy-test$', '--play-manual', '^qa-gate$'];

  const none = await run('gitlab-test-release-driver.mjs', args, payload('release_test'), options);
  assert.equal(none.json.status, 'awaiting_receipt');
  assert.match(none.json.reason, /no pipeline yet/);

  pipelines.set(11, { id: 11, sha: integration, status: 'manual', web_url: 'https://gitlab.example.com/p/11' });
  jobs.set(11, [{ id: 101, name: 'qa-gate', status: 'manual' }, { id: 102, name: 'deploy-test', status: 'created' }]);
  const pending = await run('gitlab-test-release-driver.mjs', args, payload('release_test_status'), options);
  assert.deepEqual(pending.json, { status: 'pending', pipeline: { api: { id: '11', url: 'https://gitlab.example.com/p/11' } } });
  assert.deepEqual(played, [101]);

  pipelines.set(11, { ...pipelines.get(11), status: 'canceled' });
  pipelines.set(12, { id: 12, sha: later, status: 'success', web_url: 'https://gitlab.example.com/p/12' });
  jobs.set(12, [{ id: 202, name: 'deploy-test', status: 'success', web_url: 'https://gitlab.example.com/j/202' }]);
  const previous = { pipeline: pending.json.pipeline };
  const superseded = await run('gitlab-test-release-driver.mjs', args, payload('release_test_status', previous), options);
  assert.equal(superseded.json.status, 'succeeded');
  assert.deepEqual(superseded.json.pipeline, previous.pipeline);
  assert.deepEqual(superseded.json.environment_revision, { api: later });
  assert.deepEqual(superseded.json.deployment, { environment: 'test', jobs: { api: { id: '202', url: 'https://gitlab.example.com/j/202', pipeline: '12' } } });

  pipelines.set(11, { ...pipelines.get(11), status: 'failed' });
  const failed = await run('gitlab-test-release-driver.mjs', args, payload('release_test_status', previous), options);
  assert.equal(failed.json.status, 'failed');
  assert.match(failed.json.reason, /pipeline 11 failed/);
});
