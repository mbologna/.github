# Versioning

Every repository under `mbologna`, on GitHub and on GitLab, versions its releases in one of
four ways. [auto-release](https://github.com/mbologna/auto-release) cuts every tag from the
commit history, and nobody tags by hand except to bootstrap a repository's first tag. Each
repository states its scheme in a `Versioning` section of its README and of its `AGENTS.md`.

## Pick the scheme

1. The repository cuts no releases (a website, shared configuration, scripts mirrored
   from elsewhere): **unversioned**.
2. What it ships is a drop-in replacement for one upstream image, that upstream plus
   patches or extra tools: **B, upstream version and release number**.
3. One upstream is the core of what it ships, and the repository pins that upstream's
   version: **A, SemVer with the upstream as build metadata**.
4. Anything else: **SemVer**.

| Scheme | Git tag | Image tags | Repositories |
|---|---|---|---|
| SemVer | `v1.4.0` | `1.4.0`, `1.4`, `latest` | most: apps, tools, packages, shared tooling |
| A | `v2.2.0+up2.15.3` | `2.2.0`, `2.2`, `latest` | rancher-platform, bitlbee-container, saltstack-container |
| B | `v4.5.2+r1`, `v7d1914b5-ls396+r1` | `4.5.2-r1`, `4.5.2`, `4.5`, `latest` | thelounge-patched, lazylibrarian-calibre |
| Unversioned | none | none | .github, michelebologna.net, dotfiles, upgrade-aged, personal-system, wallpaper-shortcuts |

## SemVer

`vX.Y.Z`, following [Semantic Versioning 2.0.0](https://semver.org/) and computed from
[Conventional Commits](https://www.conventionalcommits.org/): a breaking change (`type!:`
or a `BREAKING CHANGE:` footer) bumps the major, a `feat` the minor, a `fix`, `perf` or
`revert` the patch. Images get `X.Y.Z`, `X.Y` and `latest`; npm and PyPI packages publish
the same version, set from the tag.

A repository that deploys every push to `main` (the calendar and RSS feeds on Cloud Run or
GitHub Pages) can still release: its tags publish nothing and carry only the release notes,
a weekly changelog of what was deployed. It is SemVer like the rest.

One exception: [ci-templates](https://gitlab.com/mbologna/ci-templates) is tagged `X.Y.Z`,
without the `v`, by hand. That is the form GitLab's CI/CD catalog and `component: ...@X.Y.Z`
take. The bump rules are the same.

## A: SemVer with the upstream as build metadata

`vX.Y.Z+up<upstream>`, for example rancher-platform's `v2.2.0+up2.15.3`: version 2.2.0 of
this repository, deploying Rancher 2.15.3.

- `X.Y.Z` follows this repository's commits, as in SemVer. The metadata states which
  upstream version the tag pins.
- SemVer ignores build metadata when it orders versions, so the repository's own version
  orders its releases, and an upstream bump never makes a tag sort out of place.
- An upstream update that breaks something for users is committed as breaking
  (`feat(deps)!: update rancher to 2.16.0`), which bumps the major. rancher-platform's
  Renovate config does this for every Rancher minor.
- A change in the pin releases on its own, as at least a patch, so the tags never lag
  behind it, even when the commit that moved it was a `chore(deps)`.
- OCI tags can't contain `+`, so images keep `X.Y.Z`, `X.Y` and `latest`. A repository
  may add the upstream version as a tag of its own: saltstack-container's images also get
  `3006.0` and `3006`.
- `up` is the only label, as in Rancher's own charts (`100.0.0+up16.6.0` tracks upstream
  16.6.0). The repository's name says which upstream it is.
- Not for npm packages: npm drops build metadata on publish. A package declares the
  upstream versions it supports in its metadata instead (`"thelounge": {"supports":
  ">=4.0.0"}`).

auto-release reads the metadata from a command: `metadata_command` in `auto-release.yml`
and in the ci-templates `auto-release` component, `release_metadata_command` in
`docker-ci.yml`. The command runs in the checkout and prints one line, such as
`printf 'up%s' "$(sed -n 's/^ARG BITLBEE_VERSION=//p' Dockerfile)"`.

## B: upstream version and release number

Git tag `v<upstream>+r<N>`, image tag `<upstream>-r<N>`: thelounge-patched's `v4.5.2+r1`
publishes `4.5.2-r1`, the first release of this repository on The Lounge 4.5.2.

- `<upstream>` is upstream's own version string, whatever its shape: `4.5.2`, or
  `7d1914b5-ls396` for a linuxserver build. Users read the tag as upstream's version,
  which is what they are replacing.
- N starts at 1 for each upstream version and counts every release on it: a patch
  change, a base image rebuild, a dependency update. This is what Debian (`4.5.2-1`),
  Bitnami (`6.4.3-debian-12-r10`), linuxserver.io (`-ls<N>`) and RKE2 (`v1.36.6+rke2r1`)
  do.
- Commit types decide whether to release, not what the tag says; a breaking change does
  not show in it.
- Releases are ordered by date, since an upstream version need not sort.
- `<upstream>-r<N>` never moves. `<upstream>` follows the newest release of that upstream
  version, and so do `X.Y` (when the upstream version is SemVer) and `latest`.
- Consumers pin `<upstream>-r<N>@sha256:…`. Renovate's docker versioning would read
  `-r<N>` as a fixed variant suffix and never offer `-r2`, so
  [`renovate-config.json`](renovate-config.json) gives each such image regex versioning.
  A new image of this kind needs a rule there.

auto-release reads the upstream version from `upstream_command` (`release_upstream_command`
in `docker-ci.yml`). It finds no earlier release on the first run, so push the first tag
by hand, once:

```sh
git tag -a -m 'v4.5.2+r1' 'v4.5.2+r1' && git push origin 'v4.5.2+r1'
gh workflow run ci.yml --ref 'v4.5.2+r1'   # GitHub; a GitLab tag starts its pipeline
```

## Unversioned

No tags and no releases: the default branch is what is deployed or used. Repositories
that call the shared workflows pin them to a commit SHA, and Renovate moves the pin.

## Why not `<upstream>-<own version>`

`2.15.3-1.0.0` reads well, but in SemVer a hyphen starts a pre-release, and a pre-release
sorts before its release: `2.15.3-1.0.0` comes before `2.15.3`. Tools that order versions
would treat every release as a pre-release of the upstream version. A puts the upstream
after a `+`, which does not affect order; B keeps the upstream first but adds a number
that does not reset this repository's own history.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/), items 9 to 11: pre-releases, build
  metadata and precedence.
- [Rancher's chart versions](https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/helm-charts-in-rancher/):
  the `+up` annotation.
- [moby/moby#16304](https://github.com/moby/moby/issues/16304) and
  [docker/cli#4877](https://github.com/docker/cli/issues/4877): `+` is not allowed in
  image tags.
- Renovate's [docker](https://docs.renovatebot.com/modules/versioning/docker/) and
  [regex](https://docs.renovatebot.com/modules/versioning/regex/) versioning.
- [Bitnami's rolling tags](https://docs.vmware.com/en/VMware-Tanzu-Application-Catalog/services/tutorials/GUID-understand-rolling-tags-containers-index.html)
  and [linuxserver.io's version tags](https://github.com/orgs/linuxserver/discussions/22).
