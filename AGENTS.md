# AGENTS.md

Notes for coding agents working in this repository. [README.md](README.md) covers the
pipeline contract, the Renovate preset and every reusable workflow.

## Versioning

This repository is unversioned: no tags, no releases. Callers pin the workflows to a
commit SHA and Renovate moves the pins; the Renovate preset is read from `main`.

- Never create tags here. A change reaches callers through their next pin update.
- [VERSIONING.md](VERSIONING.md) is the versioning standard for every mbologna
  repository. A change to how auto-release, `docker-ci.yml` or the ci-templates
  components form or order tags must keep it true, and a new pattern B image needs its
  Renovate regex rule in `renovate-config.json`.
