#!/usr/bin/env bash
# Puts the image in a registry.
#   scripts/ci/publish.sh push LOCAL_IMAGE TARGET...   tags a local image as each TARGET and pushes it
#   scripts/ci/publish.sh promote SOURCE TARGET...     points more tags at an image already in the
#                                                      registry, so what is deployed is what was tested
# Signs in first when REGISTRY_USER and REGISTRY_PASSWORD are set, for this run only.
# For a single fully qualified push target, PUBLISH_DIGEST_OUTPUT receives image, digest and
# image_ref outputs after the push confirms its repository and digest. Later jobs must use
# image_ref rather than resolving the mutable tag again. Other CI callers need no output file.
set -euo pipefail
mode="${1:-}"; source="${2:-}"
if [ "$#" -lt 3 ] || { [ "$mode" != push ] && [ "$mode" != promote ]; }; then
  echo "usage: scripts/ci/publish.sh push|promote SOURCE TARGET..." >&2
  exit 2
fi
shift 2
step() { printf '\n==> %s\n' "$*"; "$@"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
private_config=""; push_log=""
cleanup() {
  [ -z "$private_config" ] || rm -rf "$private_config"
  [ -z "$push_log" ] || rm -f "$push_log"
}
trap cleanup EXIT

if [ -n "${PUBLISH_DIGEST_OUTPUT:-}" ]; then
  [ "$mode" = push ] && [ "$#" -eq 1 ] || fail "Digest output requires one push target."
  target="$1"
  repository="${target%:*}"; tag="${target##*:}"
  # A registry-qualified tagged reference keeps Docker Hub's implicit name rewriting out of
  # this handoff. Ports are allowed in the registry; the final colon must introduce the tag.
  [[ "$target" =~ ^[a-z0-9][a-z0-9.:-]*/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || fail "Digest output requires a fully qualified tagged image."
  registry="${repository%%/*}"
  case "$registry" in *.*|*:*|localhost) ;; *) fail "Digest output requires an explicit registry." ;; esac
fi

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
  private_config="$DOCKER_CONFIG"
  for part in cli-plugins contexts; do
    [ ! -d "$config/$part" ] || ln -s "$config/$part" "$DOCKER_CONFIG/$part"
  done
  # Base64 on one line (GNU base64 wraps long output unless given -w0).
  b64() { if base64 -w0 </dev/null >/dev/null 2>&1; then base64 -w0; else base64 | tr -d '\n'; fi; }
  auth="$(printf '%s:%s' "$REGISTRY_USER" "$REGISTRY_PASSWORD" | b64)"
  (umask 077; printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$registry" "$auth" > "$DOCKER_CONFIG/config.json")
fi

if [ "$mode" = push ]; then
  for target in "$@"; do
    step docker tag "$source" "$target"
    if [ -z "${PUBLISH_DIGEST_OUTPUT:-}" ]; then
      step docker push "$target"
      continue
    fi
    push_log="$(mktemp)"
    step docker push "$target" 2>&1 | tee "$push_log"
    repositories=0; digests=0; digest=""
    # Read the result of THIS push, never a later tag lookup: another run can replace the tag.
    while IFS= read -r line; do
      line="${line%$'\r'}"
      if [[ "$line" == 'The push refers to repository '* ]]; then
        repositories=$((repositories + 1))
        [ "$line" = "The push refers to repository [$repository]" ] || fail "Pushed repository does not match the requested image."
      fi
      if [[ "$line" == *' digest: '* ]]; then
        digests=$((digests + 1))
        [[ "$line" =~ ^([^[:space:]]+):[[:space:]]digest:[[:space:]](sha256:[a-f0-9]{64})[[:space:]]size:[[:space:]][0-9]+[[:space:]]*$ ]] || fail "Push did not return a valid image digest."
        [ "${BASH_REMATCH[1]}" = "$tag" ] || fail "Pushed tag does not match the requested image."
        digest="${BASH_REMATCH[2]}"
      fi
    done < "$push_log"
    [ "$repositories" -eq 1 ] && [ "$digests" -eq 1 ] || fail "Push must confirm exactly one repository and image digest."
    printf 'image=%s\ndigest=%s\nimage_ref=%s@%s\n' "$repository" "$digest" "$repository" "$digest" >> "$PUBLISH_DIGEST_OUTPUT"
  done
elif docker buildx imagetools --help >/dev/null 2>&1; then
  # Copy the image as it is; by default a single image would be wrapped in a new index.
  as_is=()
  case "$(docker buildx imagetools create --help 2>&1 || true)" in *--prefer-index*) as_is=(--prefer-index=false) ;; esac
  for target in "$@"; do step docker buildx imagetools create "${as_is[@]}" --tag "$target" "$source"; done
else
  step docker pull "$source"
  for target in "$@"; do step docker tag "$source" "$target"; step docker push "$target"; done
fi
