#!/usr/bin/env bash
# Runs on the server, in the deployment folder, for scripts/deploy.sh (or by hand, to roll back):
#
#   bash deploy-remote.sh IMAGE [REGISTRY_USER] [BACKUP=1] [HEALTH_TIMEOUT=180]
#
# With REGISTRY_USER, the registry password is read from standard input. The folder holds
# compose.yaml and an operator-managed .env (PUBLIC_ORIGIN, optionally APP_PORT); this script
# records the running image there as APP_IMAGE.
#  1. Pulls IMAGE.
#  2. If the app is running: stops it and backs up the database and media into backups/ with the
#     current image (scripts/backup.sh, 14 kept). A failed backup restarts the app and changes nothing.
#  3. Starts IMAGE and waits until /api/health answers. If it does not, the previous image is started
#     again and the deployment fails. The backup from step 2 is there should the data need restoring.
set -euo pipefail
image="${1:?usage: deploy-remote.sh IMAGE [REGISTRY_USER] [BACKUP] [HEALTH_TIMEOUT]}"
registry_user="${2:-}"
backup="${3:-1}"
timeout="${4:-180}"
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf 'deploy: %s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }
set_setting() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
healthy() {
  docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
}
start() {
  docker compose up --detach --no-build --wait --wait-timeout "$timeout" app && healthy
}

docker compose version >/dev/null 2>&1 || fail "the server needs Docker with the Compose plugin (docker compose version)."
if [ ! -f .env ] || ! grep -q '^PUBLIC_ORIGIN=.' .env; then
  fail "create $PWD/.env with PUBLIC_ORIGIN=https://<the site's address> first (docs/DEPLOYMENT.md)."
fi
# One deployment at a time.
exec 9> .deploy.lock
flock -n 9 || fail "another deployment is running in $PWD."
# The project name keeps the data volume's name, whatever this folder is called.
grep -q '^COMPOSE_PROJECT_NAME=' .env || printf 'COMPOSE_PROJECT_NAME=bangla-adventures\n' >> .env
previous="$(setting APP_IMAGE)"

say "pulling $image"
if [ -n "$registry_user" ]; then
  password="$(cat)"
  # A private credentials folder for this pull only, so the login is not kept on the server.
  login="$(mktemp -d)"
  trap 'rm -rf "$login"' EXIT
  registry="${image%%/*}"
  case "$registry" in *.*|*:*|localhost) ;; *) registry="" ;; esac
  printf '%s' "$password" | DOCKER_CONFIG="$login" docker login ${registry:+"$registry"} --username "$registry_user" \
    --password-stdin >/dev/null 2>"$login/error" || { cat "$login/error" >&2; fail "could not sign in to the registry."; }
  DOCKER_CONFIG="$login" docker pull "$image"
  rm -rf "$login"
else
  docker pull "$image"
fi

if [ "$backup" = 1 ] && [ "$(docker compose ps --status running --services app 2>/dev/null)" = app ]; then
  mkdir -p backups
  # The app's user (uid 1000) writes the archives; nobody else may read them.
  docker run --rm --user root --entrypoint sh --volume "$PWD/backups:/backups" "$image" \
    -c 'chown 1000:1000 /backups && chmod 0700 /backups'
  say "stopping the app for a consistent backup"
  docker compose stop app
  if ! docker compose run --rm --no-deps --volume "$PWD/backups:/backups" app \
    bash scripts/backup.sh /backups 14 --application-stopped; then
    docker compose start app || true
    fail "the backup failed, so the app was started again on its current version and nothing changed."
  fi
fi

set_setting APP_IMAGE "$image"
say "starting $image"
if start; then
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$image" >> deployments.log
  # Keep this image and the previous one; remove older ones of the same name to save disk space.
  # Only for a tagged name (NAME:TAG, not a digest); the tag is in the last part, after any port.
  last="${image##*/}"
  if [ "${last#*:}" != "$last" ] && [ "${image#*@}" = "$image" ]; then
    name="${image%:*}"
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$name" | while read -r old; do
      [ "$old" = "$image" ] || [ "$old" = "$previous" ] || docker image rm "$old" >/dev/null 2>&1 || true
    done
  fi
  say "deployed $image"
  exit 0
fi

docker compose logs --tail 80 app >&2 || true
if [ -n "$previous" ] && [ "$previous" != "$image" ]; then
  set_setting APP_IMAGE "$previous"
  start || true
  fail "$image did not become healthy; $previous is running again."
fi
fail "$image did not become healthy, and there is no earlier version to go back to."
