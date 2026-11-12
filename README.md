# mbologna/.github

The shared Renovate preset and the reusable GitHub Actions workflows for the
repositories under `mbologna`. The GitLab projects get the same pipeline from
[`mbologna/ci-templates`](https://gitlab.com/mbologna/ci-templates).

- [`renovate-config.json`](renovate-config.json): the Renovate preset. A
  repository's `renovate.json` extends `github>mbologna/.github//renovate-config.json`
  and keeps only what is specific to it.
- [`.github/workflows/`](.github/workflows): reusable workflows. Callers pin
  them to a commit SHA with a `# main` comment, and Renovate moves the pin.

## Pipeline contract

Every repository that ships something runs the same pipeline, on GitHub and on
GitLab:

| Event | What runs |
|---|---|
| Pull request | Title check (a Conventional Commit, since the squash-merge subject is the PR title and auto-release reads it). Language tests: lint, format check, tests, and an audit of the runtime dependencies. Image build without push, unless every changed file matches `skip_paths`. hadolint when the Dockerfile changed. |
| Push to the default branch | Security check only: auto-release's `security` strategy releases a CVE fix at once. Nothing is built, except with `publish: push` (the Cloud Run repositories, which deploy every push that changes the image). |
| Monday 06:00 UTC schedule | Conventional release: auto-release tags `vX.Y.Z` when a `feat`, `fix`, `perf`, `revert` or breaking commit landed since the last tag. |
| Release tag `vX.Y.Z` | Build and push `X.Y.Z`, `X.Y` and `latest`, then a Trivy report (fixable HIGH and CRITICAL findings; a report, not a gate) and a cosign keyless signature. |

What differs from GitLab, on purpose:

- **Registries:** GHCR and Docker Hub here, the GitLab project registry there.
- **Architectures:** images here are built for linux/amd64 and linux/arm64,
  because some consumers run on arm64. GitLab images are amd64 only.
- **Runners:** GitHub-hosted here; the self-hosted runner or gitlab.com's
  shared runners there.

A typical caller, for a Python project that ships an image:

```yaml
on:
  push:
    branches: [main]
    tags: ["v*.*.*"]
  pull_request:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  python:
    uses: mbologna/.github/.github/workflows/python-ci.yml@<sha> # main
    with:
      python_version: "3.15"

  docker:
    needs: python
    permissions:
      contents: write        # the release tag and its Release
      actions: write         # dispatch the tag build
      packages: write        # push to GHCR
      id-token: write        # cosign keyless signing
      attestations: write
      security-events: write # Trivy SARIF upload
    uses: mbologna/.github/.github/workflows/docker-ci.yml@<sha> # main
    with:
      image_name: my-app
      publish: release
      release_strategy: conventional
    secrets: inherit
```

plus a `pr-title.yml` that calls `pr-title.yml` on `pull_request`
(`types: [opened, edited, synchronize, reopened]`).

## Reusable workflows

Check names (`<caller job> / <job name>`) are what the repositories' rulesets
require, so job names don't change.

### docker-ci.yml

Lint (hadolint, yamllint), a native per-platform build (`Build (linux/amd64)`,
`Build (linux/arm64)`), the multi-arch manifest, SBOM, Trivy, cosign, an
optional integration test and GHCR cleanup. Optionally runs `auto-release.yml`
and `gcp-deploy.yml` as nested jobs.

| Input | Default | Meaning |
|---|---|---|
| `image_name` | required | Image name without registry |
| `publish` | `push` | `release`: only `v*` tags push, and `latest` goes to the newest release. `push`: the default branch, schedules and tags push (the Cloud Run repositories) |
| `skip_paths` | `.github/*`, `docs/*`, `tests/*`, `*.md`, `renovate.json`, `.pre-commit-config.yaml`, `.gitignore`, `LICENSE` | A pull request or branch push whose changed files all match builds nothing |
| `dockerfile` | `Dockerfile` | Dockerfile path |
| `legacy_image_names` | empty | Former image names that keep getting the same tags |
| `version_command` | empty | Command run in the image that prints a version to tag |
| `extra_tags` | empty | Extra docker/metadata-action tag rules |
| `push_to_dockerhub` | `true` | Also push to Docker Hub (`DOCKER_USERNAME`, `DOCKER_PASSWORD`) |
| `enable_cosign` | `true` | Sign the images |
| `enable_integration_test` | `false` | Run `scripts/integration-test.sh` against the pushed image |
| `yamllint_paths` | `.github/workflows/` | Paths for yamllint |
| `release_strategy` | empty | Runs auto-release after the build with this scheduled strategy (normally `conventional`); empty runs none. The calling job grants `contents: write` and `actions: write` |
| `release_image` | `ghcr.io/<owner>/<image_name>` | Image auto-release logs in to |
| `dockerfiles` | the `dockerfile` input | Dockerfiles the security strategy compares |
| `dispatch_workflow` | the calling workflow | Workflow auto-release starts on the new tag |
| `deploy_type` | empty | `service` or `job`: deploy the `sha-*` image to Cloud Run after a push or manual run on the default branch that pushed an image; empty deploys nothing |
| `deploy_name` | `image_name` | Cloud Run service or job |
| `region` | `us-central1` | Cloud Run region |

Output: `digest`, the multi-arch digest (empty when nothing was pushed).

### auto-release.yml

Runs the [auto-release](https://github.com/mbologna/auto-release) image: tags
the next version and publishes its Release. It gates itself: it runs on a
schedule, or on a push or manual run on the default branch, and skips
everything else. A push runs the `security` strategy, a manual run `commits`,
a schedule the caller's `strategy`. The calling job grants `contents: write`
and `actions: write`; the caller lists `workflow_dispatch` in its `on:`.

Inputs: `strategy` (required, `conventional` or `commits`), `image`,
`dockerfiles`, `base_image_pattern`, `dispatch_tag_build` (default `true`),
`dispatch_workflow`, `dry_run` (also true when the caller's
`workflow_dispatch` has a `dry_run` input set to true).

### gcp-deploy.yml

Deploys `<image_registry>/<image_name>:sha-<commit>` to a Cloud Run service or
job with Workload Identity Federation. docker-ci calls it through
`deploy_type`. Inputs: `image_name`, `deploy_name` (required), `deploy_type`
(default `service`), `region` (default `us-central1`), `image_registry`.
Secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`.

### python-ci.yml

`Lint` (`ruff check`, `ruff format --check`) and `Test` (pytest, then
pip-audit on the locked runtime dependencies:
`uv export --frozen --no-dev --no-emit-project --no-hashes --format requirements-txt | uvx pip-audit==<pin> -r /dev/stdin --no-deps --disable-pip`).
uv only, with `uv sync --locked`, so a stale `uv.lock` fails. Inputs:
`python_version` (default `3.15`; callers set the Python their Dockerfile
ships), `enable_codecov` (default `true`), `pip_audit_version` (tracked by
Renovate; callers leave it).

### php-ci.yml

`PHP <version>` (composer install, `composer audit --locked --no-dev`, tests)
and an optional `Lint PHP`. Inputs: `php_version`, `php_extensions`,
`composer_options`, `enable_composer_cache`, `pre_test_command`,
`test_command`, `enable_test`, `enable_lint`, `lint_command`, `lint_tools`.

### go-ci.yml

`Lint` and `Test`. Inputs: `go_version_file` (default `go.mod`), `test_flags`
(default `-race`).

### node-ci.yml and npm-publish.yml

node-ci: tests on one Node.js version or a matrix, an optional build artifact
and an optional `npm audit`. Inputs: `node_version`, `node_versions`,
`package_manager`, `test_command`, `enable_audit`, `audit_level`,
`audit_omit_dev`, `build_command`, `build_artifact_name`,
`build_artifact_path`, `build_artifact_retention_days`.

npm-publish: publishes the tagged version to npm with provenance. Inputs:
`node_version`, `package_manager`. The caller runs it on the tag build that
auto-release dispatches.

### terraform-ci.yml

Terraform and OpenTofu fmt and validate, tflint, yamllint, actionlint, a Trivy
config scan and optional ShellCheck. Inputs: `terraform_version`,
`opentofu_version`, `working_dir`, `example_dir`, `enable_shellcheck`,
`shellcheck_files`.

### pr-title.yml

`Conventional PR title`: fails unless the pull request title is a
Conventional Commit subject.

`renovate-config-validate.yml` is not reusable: it validates
`renovate-config.json` when it changes here.
