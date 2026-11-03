# Reference GitLab drivers

These drivers show how a project connects cc-nexs to GitLab. They have no
dependencies beyond Node.js 20 and Git. Copy one into your workspace,
point the config at it, and adapt the job patterns to your pipeline.

## Base release: `gitlab-mr-driver.mjs`

For protected bases. The controller sends the assigned feature branch and the
exact approved candidate. The driver pushes that commit with GitLab merge
request push options, or finds and creates the MR through the API when the
branch already sits at the candidate. It never force-pushes, merges, squashes,
or rebases.

```yaml
release:
  base:
    driver:
      command: node
      args: [tools/gitlab-mr-driver.mjs, --repo, web=web, --repo, api=services/api]
```

## Test release: `gitlab-test-release-driver.mjs`

Reads pipelines for the Test integration commit through the API, so no browser
is needed to observe CI. Deploy jobs are found in the pipeline and in child
pipelines started by trigger jobs; every job matching `--deploy-job` must
succeed. A manual gate or deploy job keeps the attempt pending until someone runs
it. A pipeline canceled by a later push to the shared Test branch is resolved from
the later successful pipeline whose commit contains the integration. A missing
token or an unreachable API returns `awaiting_receipt`, so the attempt is resumed
rather than failed. `--play-manual <regex>` plays matching manual jobs once; use it
only where your team allows automation to pass that gate in Test.

```yaml
release:
  test:
    environment: test
    driver:
      command: node
      args: [tools/gitlab-test-release-driver.mjs, --repo, web=web, --deploy-job, "^deploy-test$"]
```

## Environment

| Variable | Use |
|---|---|
| `GITLAB_TOKEN` | API token (`read_api` for the Test driver; `api` to create MRs or play jobs) |
| `GITLAB_API_URL` | Defaults to `https://<origin host>/api/v4` |
| `GITLAB_PROJECT` | Project path, when `origin` is not a GitLab URL |

Keep the token in the environment or a credential helper. Never write it into the
repository, the workspace config, or a prompt.
