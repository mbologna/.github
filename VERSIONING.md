# Versioning

Every repository under `mbologna`, on GitHub and on GitLab, either versions its releases
with [Semantic Versioning 2.0.0](https://semver.org/) or cuts no releases at all.
[auto-release](https://github.com/mbologna/auto-release) cuts every tag from the commit
history, and nobody tags by hand except to bootstrap a repository's first tag. Each
repository states its scheme in a `Versioning` section of its README and of its `AGENTS.md`.

## Pick the scheme

1. The repository cuts no releases (a website, shared configuration, scripts mirrored
   from elsewhere): **unversioned**.
2. It is built on one upstream and pins that upstream's version: a patched upstream
   image, a deployment of the upstream, a bundle around it. Use **SemVer with the upstream
   as build metadata**.
3. Anything else: **SemVer**.

| Scheme | Git tag | Image tags | Repositories |
|---|---|---|---|
| SemVer | `v1.4.0` | `1.4.0`, `1.4`, `latest` | most: apps, tools, packages, shared tooling |
| SemVer + upstream | `v2.2.0+up2.15.3` | `2.2.0`, `2.2`, `latest` | rancher-platform, bitlbee-container, saltstack-container, thelounge-patched |
| Unversioned | none | none | .github, upgrade-aged, the website, configuration repositories |

## SemVer

`vX.Y.Z`, computed from [Conventional Commits](https://www.conventionalcommits.org/): a
breaking change (`type!:` or a `BREAKING CHANGE:` footer) bumps the major, a `feat` the
minor, and a `fix`, `perf` or `revert` the patch. Images get `X.Y.Z`, `X.Y` and `latest`.
npm and PyPI packages publish the same version, set from the tag.

A repository that deploys every push to `main` (the calendar and RSS feeds on Cloud Run or
GitHub Pages) can still release. Its tags publish nothing and carry only the release
notes, a weekly changelog of what was deployed. It is SemVer like the rest.

One exception: [ci-templates](https://gitlab.com/mbologna/ci-templates) is tagged `X.Y.Z`,
without the `v`, by hand. That is the form GitLab's CI/CD catalog and
`component: ...@X.Y.Z` take. The bump rules are the same.

## SemVer with the upstream as build metadata

`vX.Y.Z+up<upstream>`. For example, rancher-platform's `v2.2.0+up2.15.3` is version 2.2.0
of this repository, deploying Rancher 2.15.3. thelounge-patched's `v1.0.0+up4.5.2` is
version 1.0.0 of its patches, on The Lounge 4.5.2.

- `X.Y.Z` follows this repository's commits, as in SemVer. The metadata states which
  upstream version the tag pins. `<upstream>` is upstream's version string as it is, such
  as `7d1914b5-ls396` for a linuxserver build.
- SemVer ignores build metadata when it orders versions, so the repository's own version
  orders its releases, and an upstream bump never makes a tag sort out of place.
- An upstream update that breaks something for users is committed as breaking
  (`feat(deps)!: update rancher to 2.16.0`), which bumps the major. rancher-platform's
  Renovate config does this for every Rancher minor. A patch that changes behaviour users
  rely on is breaking too.
- A change in the pin releases on its own, as at least a patch, so the tags never lag
  behind it, even when the commit that moved it was a `chore(deps)`.
- `up` is the only label, as in Rancher's own charts (`100.0.0+up16.6.0` tracks upstream
  16.6.0). The repository's name says which upstream it is.
- **Images:** OCI tags can't contain `+`, so images get `X.Y.Z`, `X.Y` and `latest`, and
  the upstream version is visible in the git tag, the release notes and the image labels.
  - Don't add an image tag that looks like a version, such as the upstream's `4.5.2`.
    Renovate would rank it above `1.0.0` and offer it as an update, or later as a
    rollback.
  - saltstack-container's `3006`/`3006.0` tags are the one exception: salt-netapi-client
    picks its fixture by Salt version, and nothing tracks those images with Renovate.
- **npm packages:** npm drops build metadata on publish. A package declares the upstream
  versions it supports in its metadata instead (`"thelounge": {"supports": ">=4.0.0"}`).

auto-release reads the metadata from a command: `metadata_command` in `auto-release.yml`
and in the ci-templates `auto-release` component, and `release_metadata_command` in
`docker-ci.yml`. The command runs in the checkout and prints one line, such as
`printf 'up%s' "$(sed -n 's/^ARG BITLBEE_VERSION=//p' Dockerfile)"`.

## Unversioned

No tags and no releases: the default branch is what is deployed or used. Repositories
that call the shared workflows pin them to a commit SHA, and Renovate moves the pin.

## Why the upstream version doesn't come first

- **`2.15.3-1.0.0` (upstream, then own version):** in SemVer a hyphen starts a
  pre-release, and a pre-release sorts before its release, so `2.15.3-1.0.0` comes before
  `2.15.3`.
- **`v4.5.2+r1`, image `4.5.2-r1` (upstream plus a release number):** this is the
  distribution packaging convention (Debian `4.5.2-1`, Bitnami `-rN`, linuxserver `-lsN`).
  It isn't SemVer:
  - SemVer counts `+r1` and `+r2` as equal, and an upstream such as `7d1914b5-ls396`
    doesn't order at all.
  - `4.5.2-r1` reads as a pre-release.
  - A breaking patch can't say so.
  - It needed date ordering in auto-release and a Renovate regex rule per image.
  
  thelounge-patched and one other patched image used it briefly (2026-11-20) before moving to
  build metadata. auto-release still supports it (`upstream_command`), but no repository
  uses it.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/), items 9 to 11: pre-releases, build
  metadata and precedence.
- [Rancher's chart versions](https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/helm-charts-in-rancher/):
  the `+up` annotation.
- [moby/moby#16304](https://github.com/moby/moby/issues/16304) and
  [docker/cli#4877](https://github.com/docker/cli/issues/4877): `+` is not allowed in
  image tags.
- Renovate's [docker versioning](https://docs.renovatebot.com/modules/versioning/docker/).
