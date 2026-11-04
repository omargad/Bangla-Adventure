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
#   DEPLOY_USER          default deploy;  DEPLOY_PORT default 22
#   DEPLOY_PATH          the deployment folder on the server, default /opt/bangla-adventures
#   REGISTRY_USER, REGISTRY_PASSWORD   for a private image; used once on the server, not stored
#   DEPLOY_BACKUP        1 (default) backs up the database and media before switching; 0 skips it
#   DEPLOY_HEALTH_TIMEOUT  seconds to wait for the new version to be healthy, default 180
set -euo pipefail
image="${1:?usage: scripts/deploy.sh IMAGE}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST to the server to deploy to.}"
: "${DEPLOY_KNOWN_HOSTS:?Set DEPLOY_KNOWN_HOSTS to the server host key line(s), from ssh-keyscan -p PORT -H HOST.}"
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
# Always a private copy: ssh refuses a key file others can read, as a CI system's file may be.
key="$work/key"
(umask 077; text_of "${DEPLOY_SSH_KEY_FILE:-${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY or DEPLOY_SSH_KEY_FILE.}}" > "$key")
text_of "$DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
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
