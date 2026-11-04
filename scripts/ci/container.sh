#!/usr/bin/env bash
# Builds the production image as IMAGE and runs the container smoke test on it.
# Needs Docker with the Compose plugin. IMAGE_SOURCE (the repository's web address) is
# recorded in the image when set; registries such as GitHub's use it to link the two.
set -euo pipefail
image="${1:?usage: scripts/ci/container.sh IMAGE}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
step() { printf '\n==> %s\n' "$*"; "$@"; }

step env PUBLIC_ORIGIN=https://bangla-container-test.example docker compose config --quiet
labels=(--label "org.opencontainers.image.revision=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
[ -z "${IMAGE_SOURCE:-}" ] || labels+=(--label "org.opencontainers.image.source=$IMAGE_SOURCE")
step docker build --tag "$image" "${labels[@]}" .
step bash scripts/test-container.sh "$image"
