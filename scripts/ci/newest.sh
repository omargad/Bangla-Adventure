#!/usr/bin/env bash
# Whether this checkout's commit is still the newest commit of BRANCH, so that only the newest one
# is marked latest and deployed: pipelines can finish out of order, and an old run started again
# would otherwise put its older commit back.
#
#   if bash scripts/ci/newest.sh BRANCH; then ...; else status=$?; [ "$status" = 1 ] || exit "$status"; fi
#
# Exits 0 when HEAD is the tip of BRANCH on the remote origin, and 1, with a notice, when the
# branch has moved on. Exit 2 means the check failed (no origin, credentials, network, or valid
# branch response). Callers must fail on 2, never publish/deploy or report a green skipped check.
set -uo pipefail
branch="${1:-}"
if [ "$#" -ne 1 ] || [ -z "$branch" ]; then echo "usage: scripts/ci/newest.sh BRANCH" >&2; exit 2; fi
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

# GitHub Actions shows these as annotations on the run; elsewhere they are plain lines.
say() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then printf '::%s::%s\n' "$1" "$2"; else printf '%s: %s\n' "$1" "$2"; fi
}
cannot_check() {
  say error "Could not check that this is the newest commit of $branch: $1. Publishing and deployment are blocked."
  exit 2
}
# Never waits for a password or a host key prompt (nobody is there to answer), nor for long.
ls_remote() {
  if command -v timeout >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never timeout 60 git ls-remote origin "$@"
  else
    GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git ls-remote origin "$@"
  fi
}

head="$(git rev-parse --verify --quiet HEAD 2>/dev/null)" || cannot_check "git cannot read this checkout's commit"
[[ "$head" =~ ^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$ ]] || cannot_check "the checkout commit is invalid"
# Git's own message is left out: it can name the remote's address, credentials included.
refs="$(ls_remote "refs/heads/$branch" 2>/dev/null </dev/null)" || cannot_check "the remote origin could not be read"
tip="$(printf '%s\n' "$refs" | awk -v ref="refs/heads/$branch" 'NF == 2 && $2 == ref { print $1 }')"
[ -n "$tip" ] || cannot_check "the remote origin has no branch of that name"
[[ "$tip" =~ ^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$ ]] || cannot_check "the remote branch response is invalid or ambiguous"

if [ "$tip" = "$head" ]; then
  echo "This commit ($head) is the newest commit of $branch."
  exit 0
fi
say notice "$branch is now at $tip, not at this commit ($head), so this commit is not marked latest or deployed."
exit 1
