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
  case "$registry" in
    docker.io|index.docker.io) registry=https://index.docker.io/v1/ ;;
    *.*|*:*|localhost) ;;
    *) registry=https://index.docker.io/v1/ ;;
  esac
  # Keep this Docker endpoint: rootless Docker and Docker Desktop reach theirs through a CLI context.
  if [ -z "${DOCKER_HOST:-}" ]; then
    DOCKER_CONTEXT="${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || true)}"; export DOCKER_CONTEXT
  fi
  config="${DOCKER_CONFIG:-$HOME/.docker}"
  # A private credentials folder, removed afterwards, so the sign-in never outlives this run. The
  # file is written here directly: docker login could hand the password to a credential helper.
  DOCKER_CONFIG="$(mktemp -d)"; export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  for part in cli-plugins contexts; do
    [ ! -d "$config/$part" ] || ln -s "$config/$part" "$DOCKER_CONFIG/$part"
  done
  # Base64 on one line (GNU base64 wraps long output unless given -w0).
  b64() { if base64 -w0 </dev/null >/dev/null 2>&1; then base64 -w0; else base64 | tr -d '\n'; fi; }
  auth="$(printf '%s:%s' "$REGISTRY_USER" "$REGISTRY_PASSWORD" | b64)"
  (umask 077; printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$registry" "$auth" > "$DOCKER_CONFIG/config.json")
fi

if [ "$mode" = push ]; then
  for target in "$@"; do step docker tag "$source" "$target"; step docker push "$target"; done
elif docker buildx imagetools --help >/dev/null 2>&1; then
  # Copy the image as it is; by default a single image would be wrapped in a new index.
  as_is=()
  case "$(docker buildx imagetools create --help 2>&1 || true)" in *--prefer-index*) as_is=(--prefer-index=false) ;; esac
  for target in "$@"; do step docker buildx imagetools create "${as_is[@]}" --tag "$target" "$source"; done
else
  step docker pull "$source"
  for target in "$@"; do step docker tag "$source" "$target"; step docker push "$target"; done
fi
