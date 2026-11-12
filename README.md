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
| Push to the default branch | Security check only: auto-release's `security` strategy releases a CVE fix at once, including a fresh rebuild when the last release is a week old and its image has fixable findings in packages it installs on top of its base. Nothing is built, except with `publish: push` (the Cloud Run repositories, which deploy every push that changes the image). |
| Monday 06:00 UTC schedule | Conventional release: auto-release tags `vX.Y.Z` when a `feat`, `fix`, `perf`, `revert` or breaking commit landed since the last tag, or a fresh rebuild is due. |
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

## Container images

One standard for every image built here and in the GitLab projects: the
runtime image carries only what the application needs to run. Each package
left in it is one more thing to patch, one more scanner finding, and one
more tool for whoever gets a shell in the container.

| Rule | Why |
|---|---|
| **Pinned bases.** `FROM image:tag@sha256:…`, from the official or upstream image; Renovate moves tag and digest. A language's build and runtime stages use the same digest. | The build is reproducible, auto-release's security strategy compares base images exactly, and compiled extensions match the runtime they run on. |
| **Multi-stage.** Compilers, build headers, package managers, git and curl exist only in the build stage. The runtime stage holds the language runtime, the application, its locked dependencies, and the OS packages the application executes. No pip, uv, npm, npx, corepack, yarn or composer, no compiler, no VCS. | Nothing to fetch or build code with at run time, and no CVEs in tools that never run (pip's vendored packages, npm's bundled dependencies). |
| **Locked dependencies, dev excluded.** Hash- or integrity-checked lock files: `uv sync --locked --no-dev`, `npm ci --omit=dev`, `composer install --no-dev --classmap-authoritative` from `composer.lock`, `go.sum`. | The image runs what CI tested. A changed or substituted artifact fails the build. |
| **Smallest base that works.** Static binaries (Go, Rust) on `scratch` or `gcr.io/distroless/static`. Interpreted runtimes on the upstream `-alpine` variant, or `-slim` when a dependency needs glibc. | Distroless doesn't ship the Python, PHP and Node versions we run, so the upstream slim or alpine image is the smallest supported choice. |
| **Non-root.** `USER` with a fixed numeric UID. Files root-owned and not writable by that user unless the application writes there. No setuid binaries added. Runtime writes go to a volume or `/tmp`, so the deployment can set `readOnlyRootFilesystem`. | A compromised process can't rewrite its own code or the OS. A numeric UID lets Kubernetes enforce `runAsNonRoot`. |
| **Clean context and layers.** A `.dockerignore`. No secrets in any layer (`RUN --mount=type=secret` for build secrets, nothing generated at build time that must stay private). No `ADD <url>`: downloads check a pinned checksum, or the checksum the upstream publishes next to the file when Renovate moves the version. | Layers can't be edited after the fact, and a public image is public. |
| **Labelled, scanned, signed.** The pipeline sets `org.opencontainers.image.source`, `.revision` and, on releases, `.version`; release builds get a Trivy report and a cosign signature (see the contract above). | Anyone can tell where an image came from, what it contains, and that this pipeline built it. |

Python images share one pattern: a build stage runs a pinned uv,
`uv sync --locked --no-dev --no-editable` into `/opt/venv` from
`pyproject.toml` and `uv.lock`, with bytecode compiled. The runtime stage
is the same `python:<version>-alpine` or `-slim` digest with `/opt/venv`
copied in, pip and ensurepip removed, a non-root UID, and the entry point
from the virtualenv.

PHP images build `vendor/` in a composer stage, and their runtime stage
purges the compilers the official `php` image keeps for
`docker-php-ext-install`. Apache listens on `${PORT}` from its config, so
it runs as `www-data` (UID 33) without editing `/etc` at start.

Exceptions, each explained in its Dockerfile or README:

- **CI job images** (auto-release) run as root and ship git, curl, crane,
  git-cliff, jq and trivy: GitHub's `container:` and GitLab's `image:` run
  the job as the image's user and write the checked-out workspace, and those
  tools are the job.
- **Images built on another project's runtime image** keep that image's user
  model. linuxserver.io images start s6-overlay as root and drop to
  `PUID`/`PGID`; when their tag comes from linuxserver's releases, a
  datasource that can't look up digests, they are pinned by tag
  (linuxserver never re-pushes an `-lsN` tag).
- **bitlbee-container**: s6-overlay runs as root as PID 1 to supervise the
  services, and each service runs as UID 1000 (`s6-setuidgid`);
  `--user 1000:1000` runs the whole container unprivileged. It builds on
  `buildpack-deps` and runs on `debian:stable-slim`, the same Debian release.
- **saltstack-container** (test fixtures for salt-netapi-client): the minion
  applies states as root, and the master's salt-api authenticates a PAM user
  from `/etc/shadow`.

To check an image by hand, this should print a non-root UID and no
paths, outside the exceptions:

```sh
docker run --rm --entrypoint sh <image> -c 'id; command -v pip uv npm composer gcc git'
```

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
| `release_image` | `ghcr.io/<owner>/<image_name>` | Image auto-release logs in to and scans for a fresh rebuild |
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
