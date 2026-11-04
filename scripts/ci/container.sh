#!/usr/bin/env bash
# Builds the production image as IMAGE and runs the container smoke test on it.
# Needs Docker with the Compose plugin. IMAGE_SOURCE (the repository's web address) is
# recorded in the image when set; registries such as GitHub's use it to link the two.
# CONTAINER_TEST_ALLOW_SKIP=1, only for a CI system whose Docker service is restricted, skips the
# checks it cannot run (the Compose file check without Compose; see scripts/test-container.sh).
set -euo pipefail
image="${1:?usage: scripts/ci/container.sh IMAGE}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
step() { printf '\n==> %s\n' "$*"; "$@"; }

if docker compose version >/dev/null 2>&1; then
  step env PUBLIC_ORIGIN=https://bangla-container-test.example docker compose config --quiet
elif [ "${CONTAINER_TEST_ALLOW_SKIP:-0}" = 1 ]; then
  echo "Skipped: checking compose.yaml (Docker Compose is not installed: docker compose version failed)"
  # Listed again in the container test's summary.
  export CONTAINER_TEST_SKIPPED=$'\n  checking compose.yaml (Docker Compose is not installed)'
else
  echo "Docker Compose is needed to check compose.yaml, and docker compose version failed. Install the" \
    "Compose plugin, or on a CI system whose Docker has none set CONTAINER_TEST_ALLOW_SKIP=1 to skip this check." >&2
  exit 1
fi
labels=(--label "org.opencontainers.image.revision=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
[ -z "${IMAGE_SOURCE:-}" ] || labels+=(--label "org.opencontainers.image.source=$IMAGE_SOURCE")
# Without the default provenance attestation, which Docker's containerd image store would push as
# an image index that GitHub's registry refuses: one manifest, carrying the labels, is pushed.
# The classic builder ignores the setting.
step env BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker build --tag "$image" "${labels[@]}" .
step bash scripts/test-container.sh "$image"
