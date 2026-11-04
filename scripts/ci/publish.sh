#!/usr/bin/env bash
# Puts the image in a registry.
#   scripts/ci/publish.sh push LOCAL_IMAGE TARGET...   tags a local image as each TARGET and pushes it
#   scripts/ci/publish.sh promote SOURCE TARGET...     points more tags at an image already in the
#                                                      registry, so what is deployed is what was tested
# Signs in first when REGISTRY_USER and REGISTRY_PASSWORD are set, for this run only.
set -euo pipefail
mode="${1:-}"; source="${2:-}"
if [ "$#" -lt 3 ] || { [ "$mode" != push ] && [ "$mode" != promote ]; }; then
  echo "usage: scripts/ci/publish.sh push|promote SOURCE TARGET..." >&2
  exit 2
fi
shift 2
step() { printf '\n==> %s\n' "$*"; "$@"; }

if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ]; then
  # The registry is the first part of the name when it looks like a host (ghcr.io/...); else Docker Hub.
  registry="${1%%/*}"
  case "$registry" in *.*|*:*|localhost) ;; *) registry="" ;; esac
  # A private credentials folder, removed afterwards, so the login never outlives this run.
  plugins="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
  DOCKER_CONFIG="$(mktemp -d)"; export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  [ ! -d "$plugins" ] || ln -s "$plugins" "$DOCKER_CONFIG/cli-plugins"
  printf '%s' "$REGISTRY_PASSWORD" | docker login ${registry:+"$registry"} --username "$REGISTRY_USER" --password-stdin
fi

if [ "$mode" = push ]; then
  for target in "$@"; do step docker tag "$source" "$target"; step docker push "$target"; done
elif docker buildx imagetools --help >/dev/null 2>&1; then
  for target in "$@"; do step docker buildx imagetools create --tag "$target" "$source"; done
else
  step docker pull "$source"
  for target in "$@"; do step docker tag "$source" "$target"; step docker push "$target"; done
fi
