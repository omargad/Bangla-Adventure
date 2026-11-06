#!/usr/bin/env bash
# Deploy a tested IMAGE over pinned SSH. Disabled unless DEPLOY_ENABLED=true and DEPLOY_HOST is set.
# The VPS defaults below are public connection metadata, never credentials or an enable switch.
# Key/known_hosts accept text, file variables, or their existing _BASE64 forms. Host keys must be
# independently verified: this script never accepts ssh-keyscan output without fingerprint checks.
# Optional ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID and
# ELEVENLABS_DAILY_CHARACTER_LIMIT are written to the server .env; an empty one leaves it unchanged.
set -euo pipefail
if [ "${DEPLOY_ENABLED:-false}" != true ]; then
  echo 'deploy: disabled (set DEPLOY_ENABLED=true explicitly to enable).'
  exit 0
fi
image="${1:?usage: scripts/deploy.sh IMAGE}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST to the server to deploy to.}"
user="${DEPLOY_USER:-deploy}"
port="${DEPLOY_PORT:-22}"
folder="${DEPLOY_PATH:-/opt/bangla-adventures}"
host_fingerprint="${DEPLOY_HOST_FINGERPRINT:-SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8}"
key_fingerprint="${DEPLOY_KEY_FINGERPRINT:-SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ}"
docker_host="${DEPLOY_DOCKER_HOST:-}"
docker_context="${DEPLOY_DOCKER_CONTEXT:-}"
require_rootless="${DEPLOY_REQUIRE_ROOTLESS:-true}"
require_public_health="${DEPLOY_REQUIRE_PUBLIC_HEALTH:-false}"
health_url="${PUBLIC_HEALTH_URL:-}"
backup="${DEPLOY_BACKUP:-1}"
health_timeout="${DEPLOY_HEALTH_TIMEOUT:-180}"
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$ ]] || fail 'invalid image reference.'
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'invalid deploy host.'
[[ "$user" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || fail 'invalid deploy user.'
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || fail 'invalid SSH port.'
[[ "$folder" =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'use an absolute deployment path without spaces or shell characters.'
[[ "$host_fingerprint" =~ ^SHA256:[a-zA-Z0-9+/]{43}$ ]] || fail 'DEPLOY_HOST_FINGERPRINT must be a SHA256 fingerprint.'
[[ "$key_fingerprint" =~ ^SHA256:[a-zA-Z0-9+/]{43}$ ]] || fail 'DEPLOY_KEY_FINGERPRINT must be a SHA256 fingerprint.'
[[ "$backup" = 0 || "$backup" = 1 ]] || fail 'DEPLOY_BACKUP must be 0 or 1.'
[[ "$health_timeout" =~ ^[1-9][0-9]{0,4}$ ]] || fail 'DEPLOY_HEALTH_TIMEOUT must be positive seconds.'
[[ "$require_rootless" = true || "$require_rootless" = false ]] || fail 'DEPLOY_REQUIRE_ROOTLESS must be true or false.'
[[ "$require_public_health" = true || "$require_public_health" = false ]] || fail 'DEPLOY_REQUIRE_PUBLIC_HEALTH must be true or false.'
[ -z "$docker_host" ] || [ -z "$docker_context" ] || fail 'select DEPLOY_DOCKER_HOST or DEPLOY_DOCKER_CONTEXT, not both.'
[ -z "$docker_host" ] || [[ "$docker_host" =~ ^unix:///[-a-zA-Z0-9_./]+$ ]] || fail 'DEPLOY_DOCKER_HOST must be an explicit local Unix socket.'
[ -z "$docker_context" ] || [[ "$docker_context" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'invalid Docker context.'
[ "$require_rootless" != true ] || [ -n "$docker_host$docker_context" ] || fail 'select a rootless Docker socket or context explicitly.'
[ -z "$health_url" ] || [[ "$health_url" =~ ^https://[^/@?#[:space:]]+([/?][^[:space:]]*)?$ ]] || fail 'PUBLIC_HEALTH_URL must be an HTTPS URL without credentials.'
if [ -z "${DEPLOY_KNOWN_HOSTS:-}${DEPLOY_KNOWN_HOSTS_BASE64:-}" ]; then
  fail 'set DEPLOY_KNOWN_HOSTS (or DEPLOY_KNOWN_HOSTS_BASE64) to independently verified host key lines.'
fi
if [ -z "${DEPLOY_SSH_KEY_FILE:-}${DEPLOY_SSH_KEY:-}${DEPLOY_SSH_KEY_BASE64:-}" ]; then
  fail 'set DEPLOY_SSH_KEY, DEPLOY_SSH_KEY_FILE or DEPLOY_SSH_KEY_BASE64.'
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."

work="$(mktemp -d)"
stage=""
stage_dispatched=false
cleanup() {
  local status=$?
  trap - EXIT
  # Before dispatch, this process owns only its unique staging folder. After
  # dispatch the remote script owns it and may still be running after SSH drops.
  if [ -n "$stage" ] && [ "$stage_dispatched" = false ]; then
    on_server "rm -rf -- $(quoted "$stage")" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
text_of() {
  local text="$1"
  if [ -f "$text" ]; then text="$(cat -- "$text")"; fi
  printf '%s\n' "$text" | tr -d '\r'
}
decoded() {
  local text
  if ! text="$(printf '%s' "${!1:-}" | tr -d ' \t\r\n' | base64 -d 2>/dev/null)" || [ -z "$text" ]; then
    printf 'deploy: %s is not valid base64.\n' "$1" >&2
    return 1
  fi
  printf '%s\n' "$text" | tr -d '\r'
}
setting() {
  if [ -n "$1" ] && [ -n "${!1:-}" ]; then text_of "${!1}"
  elif [ -n "${!2:-}" ]; then text_of "${!2}"
  else decoded "$3"
  fi
}
# Narration settings are checked here, before any connection, and reach the server only on the
# dispatch's standard input: never on a command line, in a trace, in a message or in a staged file.
(
  { set +x; } 2>/dev/null
  umask 077
  LC_ALL=C
  for name in ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID ELEVENLABS_MODEL_ID ELEVENLABS_DAILY_CHARACTER_LIMIT; do
    value="${!name:-}"
    [ -n "$value" ] || continue
    case "$name" in
      # Compose would expand a $ in .env; quotes, backslashes and spaces never belong in a key.
      ELEVENLABS_API_KEY) [[ "$value" =~ ^[[:graph:]]{20,200}$ && "$value" != *[\"\'\\\$\`]* ]] || \
        fail 'ELEVENLABS_API_KEY must be the key alone: 20 to 200 printable characters without spaces, quotes, backslashes or $.' ;;
      ELEVENLABS_VOICE_ID) [[ "$value" =~ ^[A-Za-z0-9]{10,40}$ ]] || fail 'ELEVENLABS_VOICE_ID must be 10 to 40 letters and digits.' ;;
      ELEVENLABS_MODEL_ID) [[ "$value" =~ ^[a-z0-9_]{3,40}$ ]] || fail 'ELEVENLABS_MODEL_ID must be 3 to 40 lowercase letters, digits or underscores.' ;;
      ELEVENLABS_DAILY_CHARACTER_LIMIT) [[ "$value" =~ ^[1-9][0-9]{0,8}$ ]] || fail 'ELEVENLABS_DAILY_CHARACTER_LIMIT must be a positive whole number.' ;;
    esac
    printf '%s=%s\n' "$name" "$value"
  done > "$work/narration.env"
)
# Child processes such as ssh never need them.
unset ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID ELEVENLABS_MODEL_ID ELEVENLABS_DAILY_CHARACTER_LIMIT
narration_lines=$(($(wc -l < "$work/narration.env")))
key="$work/key"
(umask 077; setting DEPLOY_SSH_KEY_FILE DEPLOY_SSH_KEY DEPLOY_SSH_KEY_BASE64 > "$key")
# Derive the public key privately, with no passphrase prompt or private-key diagnostic output.
ssh-keygen -y -P '' -f "$key" > "$work/public_key" 2>/dev/null || fail 'the deploy private key could not be read (an unencrypted CI key is required).'
actual="$(ssh-keygen -l -E sha256 -f "$work/public_key" 2>/dev/null | awk '{print $2}')" || fail 'could not fingerprint the deploy key.'
[ "$actual" = "$key_fingerprint" ] || fail 'the deploy key fingerprint does not match DEPLOY_KEY_FINGERPRINT.'
setting '' DEPLOY_KNOWN_HOSTS DEPLOY_KNOWN_HOSTS_BASE64 > "$work/provided_hosts"
: > "$work/known_hosts"
# Every retained line must match the pin. A valid line cannot hide an additional unverified key.
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*@ ]] && fail 'host key markers are not allowed; provide the pinned host key directly.'
  printf '%s\n' "$line" > "$work/host_line"
  actual="$(ssh-keygen -l -E sha256 -f "$work/host_line" 2>/dev/null | awk '{print $2}')" || fail 'a known_hosts entry is not a valid SSH host key.'
  [ "$actual" = "$host_fingerprint" ] || fail 'a known_hosts fingerprint does not match DEPLOY_HOST_FINGERPRINT.'
  printf '%s\n' "$line" >> "$work/known_hosts"
done < "$work/provided_hosts"
[ -s "$work/known_hosts" ] || fail 'no verified host key was provided.'
lookup="$DEPLOY_HOST"
[ "$port" = 22 ] || lookup="[$DEPLOY_HOST]:$port"
ssh-keygen -F "$lookup" -f "$work/known_hosts" >/dev/null 2>&1 || fail 'the verified known_hosts entries do not cover the deploy host and port.'
ssh_options=(-F /dev/null -i "$key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o GlobalKnownHostsFile=/dev/null
  -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=20)
# All nonsecret parameters are validated above and quoted for the remote Bash shell.
# shellcheck disable=SC2029
on_server() { ssh "${ssh_options[@]}" "$user@$DEPLOY_HOST" "$@"; }
quoted() { printf '%q' "$1"; }
echo "deploy: $image to $user@$DEPLOY_HOST:$folder"
# Uploads never replace live deployment files. Each attempt gets an isolated
# directory; the remote script promotes it only while holding the deploy lock.
candidate="$(on_server "umask 077; mkdir -p $(quoted "$folder") && mktemp -d $(quoted "$folder/.deploy-stage.XXXXXXXXXX")")" || fail 'could not create the remote staging directory.'
stage_name="${candidate##*/}"
[[ "$candidate" = "$folder/$stage_name" ]] && [[ "$stage_name" =~ ^\.deploy-stage\.[a-zA-Z0-9]+$ ]] || fail 'the server returned an invalid staging directory.'
stage="$candidate"
upload() {
  on_server "cat > $(quoted "$stage/$1.new") && mv -f $(quoted "$stage/$1.new") $(quoted "$stage/$1")" < "$2"
}
upload compose.yaml compose.yaml
upload deploy-remote.sh scripts/deploy-remote.sh
# The narration lines, then the registry password, reach the server on standard input, never on a
# command line or in the stage, so a dispatch that fails leaves no secret behind. Only their count
# is an argument. The remote script must now clean its stage, including on a refused deployment.
stage_dispatched=true
{ cat "$work/narration.env"; printf '%s' "${REGISTRY_PASSWORD:-}"; } | on_server "bash $(quoted "$stage/deploy-remote.sh") $(quoted "$image") \
$(quoted "${REGISTRY_USER:-}") $(quoted "$backup") $(quoted "$health_timeout") \
$(quoted "$docker_host") $(quoted "$docker_context") $(quoted "$require_rootless") \
$(quoted "$health_url") $(quoted "$require_public_health") $(quoted "$folder") $(quoted "$stage") \
$(quoted "$narration_lines")"
