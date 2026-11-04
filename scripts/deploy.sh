#!/usr/bin/env bash
# Deploys IMAGE (a registry name with its tag) to the server over SSH. The server pulls it and
# runs it with Docker Compose, after a backup, and goes back to the previous image if the new one
# does not become healthy (scripts/deploy-remote.sh does that part on the server).
#
#   scripts/deploy.sh ghcr.io/OWNER/REPOSITORY:sha-COMMIT
#
# Settings, from the environment (docs/DEPLOYMENT.md "Automatic deployment"):
#   DEPLOY_HOST          the server's name or address (required)
#   DEPLOY_KNOWN_HOSTS   its SSH host key line(s), from `ssh-keyscan -p PORT -H HOST` (required)
#   DEPLOY_SSH_KEY       the deploy user's private key, or DEPLOY_SSH_KEY_FILE pointing to it
#                        (each of these two may also be the path of a file holding the text, as
#                        GitLab's File-type variables are)
#   DEPLOY_SSH_KEY_BASE64, DEPLOY_KNOWN_HOSTS_BASE64   instead, the same texts as one line of base64
#                        (`base64 -w0 FILE`; on macOS `base64 -i FILE`), for CI systems whose
#                        secrets cannot hold several lines. When more than one form is set, the
#                        _FILE one is used first, then the text or path, then the _BASE64 one
#   DEPLOY_USER          default deploy;  DEPLOY_PORT default 22
#   DEPLOY_PATH          the deployment folder on the server, default /opt/bangla-adventures
#   REGISTRY_USER, REGISTRY_PASSWORD   for a private image; used once on the server, not stored
#   DEPLOY_BACKUP        1 (default) backs up the database and media before switching; 0 skips it
#   DEPLOY_HEALTH_TIMEOUT  seconds to wait for the new version to be healthy, default 180
set -euo pipefail
image="${1:?usage: scripts/deploy.sh IMAGE}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST to the server to deploy to.}"
if [ -z "${DEPLOY_KNOWN_HOSTS:-}${DEPLOY_KNOWN_HOSTS_BASE64:-}" ]; then
  echo "Set DEPLOY_KNOWN_HOSTS (or DEPLOY_KNOWN_HOSTS_BASE64) to the server host key line(s), from ssh-keyscan -p PORT -H HOST." >&2
  exit 1
fi
if [ -z "${DEPLOY_SSH_KEY_FILE:-}${DEPLOY_SSH_KEY:-}${DEPLOY_SSH_KEY_BASE64:-}" ]; then
  echo "Set DEPLOY_SSH_KEY, DEPLOY_SSH_KEY_FILE or DEPLOY_SSH_KEY_BASE64 to the deploy user's private key." >&2
  exit 1
fi
user="${DEPLOY_USER:-deploy}"
port="${DEPLOY_PORT:-22}"
folder="${DEPLOY_PATH:-/opt/bangla-adventures}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The text of a setting that holds either the text or the path of a file with it. A value pasted
# from Windows may carry carriage returns, which ssh rejects, so they are removed.
text_of() {
  local text="$1"
  if [ -f "$text" ]; then text="$(cat -- "$text")"; fi
  printf '%s\n' "$text" | tr -d '\r'
}
# The text of a _BASE64 setting (named by $1). Spaces and line breaks in the encoded value are
# ignored; the decoded text is never printed.
decoded() {
  local text
  if ! text="$(printf '%s' "${!1:-}" | tr -d ' \t\r\n' | base64 -d 2>/dev/null)" || [ -z "$text" ]; then
    echo "$1 is not valid base64 (make it with: base64 -w0 FILE)." >&2
    return 1
  fi
  printf '%s\n' "$text" | tr -d '\r'
}
# The text of a setting given in any of its forms: $1 is the name of the _FILE or text-or-path
# setting to try first (empty to skip), $2 the text-or-path one, $3 the _BASE64 one.
setting() {
  if [ -n "$1" ] && [ -n "${!1:-}" ]; then text_of "${!1}"
  elif [ -n "${!2:-}" ]; then text_of "${!2}"
  else decoded "$3"
  fi
}
# Always a private copy: ssh refuses a key file others can read, as a CI system's file may be.
key="$work/key"
(umask 077; setting DEPLOY_SSH_KEY_FILE DEPLOY_SSH_KEY DEPLOY_SSH_KEY_BASE64 > "$key")
if ! grep -q 'PRIVATE KEY-----' "$key"; then
  echo "The deploy key is not an SSH private key: its text should start with a -----BEGIN ... PRIVATE KEY----- line." >&2
  exit 1
fi
setting '' DEPLOY_KNOWN_HOSTS DEPLOY_KNOWN_HOSTS_BASE64 > "$work/known_hosts"
ssh_options=(-i "$key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=20)
# The remote commands are built here on purpose, with every value quoted for the server's shell.
# shellcheck disable=SC2029
on_server() { ssh "${ssh_options[@]}" "$user@$DEPLOY_HOST" "$@"; }
quoted() { printf '%q' "$1"; }

echo "deploy: $image to $user@$DEPLOY_HOST:$folder"
on_server "mkdir -p $(quoted "$folder")"
# Each file is written beside the old one and then moved into place: a deployment still running
# keeps reading its own copy of the script (bash reads it as it goes) when this one is refused.
upload() {
  on_server "cat > $(quoted "$folder/$1.new") && mv -f $(quoted "$folder/$1.new") \
$(quoted "$folder/$1")" < "$2"
}
upload compose.yaml compose.yaml
upload deploy-remote.sh scripts/deploy-remote.sh
# The registry password reaches the server on standard input, never on a command line.
printf '%s' "${REGISTRY_PASSWORD:-}" | on_server "bash $(quoted "$folder/deploy-remote.sh") $(quoted "$image") \
$(quoted "${REGISTRY_USER:-}") $(quoted "${DEPLOY_BACKUP:-1}") $(quoted "${DEPLOY_HEALTH_TIMEOUT:-180}")"
