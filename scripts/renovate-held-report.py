#!/usr/bin/env python3
"""Report the Renovate updates that minimumReleaseAge holds for good.

Reads a Renovate run log (LOG_LEVEL=debug, LOG_FORMAT=json) on stdin and
prints a Markdown report. The first line of the report is the number of
findings. Two kinds of findings:

- Releases with no release date. Under the default
  minimumReleaseAgeBehaviour=timestamp-required these stay pending forever.
  Renovate says so only in a debug line. When the update shares a branch with
  dated ones, the Dependency Dashboard doesn't show it either.
- Dated updates still pending after PENDING_DAYS. That is longer than any age
  gate should last, so something other than the gate is holding them.

Repositories named in PRIVATE get counts only, because the report goes to a
public issue.
"""

import datetime as dt
import json
import os
import sys
from collections import defaultdict

PENDING_DAYS = int(os.environ.get("PENDING_DAYS", "95"))
PRIVATE = set(os.environ.get("PRIVATE", "").split())
DATELESS = "do not have a releaseTimestamp and we're running with minimumReleaseAgeBehaviour=timestamp-required"


def scan(lines, now):
    """Return (repositories seen, dateless {repo: {dep}}, overdue {repo: {(dep, current, new, days)}})."""
    repos, dateless, overdue = set(), defaultdict(set), defaultdict(set)
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        repo = rec.get("repository")
        if not repo:
            continue
        repos.add(repo)
        msg = rec.get("msg", "")
        if DATELESS in msg:
            dateless[repo].update(u.get("depName") or "an unnamed dependency" for u in rec.get("updates", []))
        elif msg == "packageFiles with updates":
            for files in rec.get("config", {}).values():
                for file in files:
                    for dep in file.get("deps", []):
                        for update in dep.get("updates", []):
                            stamp = update.get("releaseTimestamp")
                            if not (update.get("pendingChecks") and stamp):
                                continue
                            age = (now - dt.datetime.fromisoformat(stamp)).days
                            if age > PENDING_DAYS:
                                new = update.get("newVersion") or update.get("newValue") or update.get("newDigest")
                                overdue[repo].add((dep.get("depName"), dep.get("currentValue"), new, age))
    return repos, dateless, overdue


def report(repos, dateless, overdue):
    lines = []
    count = 0
    for repo in sorted(set(dateless) | set(overdue)):
        found = len(dateless.get(repo, ())) + len(overdue.get(repo, ()))
        count += found
        lines.append(f"\n### {repo}\n")
        if repo in PRIVATE:
            lines.append(f"- {found} held update(s), not listed: the repository is private and this report is not.")
            continue
        for dep in sorted(dateless.get(repo, ())):
            lines.append(f"- `{dep}`: a release has no release date, so `minimumReleaseAge` keeps it pending forever.")
        for dep, current, new, age in sorted(overdue.get(repo, ()), key=str):
            lines.append(f"- `{dep}` {current} → {new}: released {age} days ago and still pending.")
    head = [
        str(count),
        f"Renovate lookup across {len(repos)} repositories: {count} update(s) held for good.",
    ]
    if count:
        head.append(
            "\nFix a dateless release by looking it up in a datasource that dates releases (a `custom.*` "
            "datasource, `github-tags`, `custom.dockerhub-suffix`). As a last resort, give that package "
            "`minimumReleaseAgeBehaviour: timestamp-optional`. For an overdue update, check the repository's "
            f"rules: no age gate in the preset lasts {PENDING_DAYS} days."
        )
    return "\n".join(head + lines) + "\n"


if __name__ == "__main__":
    print(report(*scan(sys.stdin, dt.datetime.now(dt.UTC))), end="")
