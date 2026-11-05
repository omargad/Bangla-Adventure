#!/usr/bin/env bash
# Runs on the server, in the deployment folder, for scripts/deploy.sh (or by hand, to roll back):
#
#   bash deploy-remote.sh IMAGE [REGISTRY_USER] [BACKUP=1] [HEALTH_TIMEOUT=180]
#     [DOCKER_HOST] [DOCKER_CONTEXT] [REQUIRE_ROOTLESS=true] [PUBLIC_HEALTH_URL]
#     [REQUIRE_PUBLIC_HEALTH=false]
#
# With REGISTRY_USER, the registry password is read from standard input. The folder holds
# compose.yaml and an operator-managed .env (PUBLIC_ORIGIN, optionally APP_PORT); this script
# records the running image there as APP_IMAGE. Its output is also added to deploy.log there, and
# it carries on to the end if the SSH session drops.
#  1. Pulls IMAGE. Without REGISTRY_USER, an IMAGE already on the server is used as it is.
#  2. If the app has a database: stops the app and backs up the database and media into backups/
#     with the current image (scripts/backup.sh, 14 kept). A failed backup restarts the app and
#     stops the deployment.
#  3. Starts IMAGE and waits until /api/health answers. If it does not, the previous image is started
#     again and the deployment fails. The backup from step 2 is there should the data need restoring.
set -euo pipefail
image="${1:?usage: deploy-remote.sh IMAGE [REGISTRY_USER] [BACKUP] [HEALTH_TIMEOUT]}"
registry_user="${2:-}"
backup="${3:-1}"
timeout="${4:-180}"
docker_host="${5-${DEPLOY_DOCKER_HOST:-${DOCKER_HOST:-}}}"
docker_context="${6-${DEPLOY_DOCKER_CONTEXT:-${DOCKER_CONTEXT:-}}}"
require_rootless="${7:-${DEPLOY_REQUIRE_ROOTLESS:-true}}"
health_url="${8-${PUBLIC_HEALTH_URL:-}}"
require_public_health="${9:-${DEPLOY_REQUIRE_PUBLIC_HEALTH:-false}}"
cd "$(dirname "${BASH_SOURCE[0]}")"
# Only .env decides these: a value left in the operator's shell must not override it.
unset APP_IMAGE COMPOSE_PROJECT_NAME

say() { printf 'deploy: %s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }
# Adds NAME=VALUE to .env on a line of its own, also when the file's last line has no newline.
add_setting() {
  if [ -s .env ] && [ -n "$(tail -c 1 .env)" ]; then printf '\n' >> .env; fi
  printf '%s=%s\n' "$1" "$2" >> .env
}
set_setting() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else add_setting "$1" "$2"; fi
}
# Base64 on one line (GNU base64 wraps long output unless given -w0).
b64() { if base64 -w0 </dev/null >/dev/null 2>&1; then base64 -w0; else base64 | tr -d '\n'; fi; }
healthy() {
  docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
}
public_healthy() {
  [ -n "$health_url" ] || return 0
  local status
  status="$(curl --proto '=https' --silent --show-error --fail --connect-timeout 10 \
    --max-time 20 --retry 2 --retry-delay 2 --retry-max-time "$timeout" \
    --output /dev/null --write-out '%{http_code}' "$health_url")" && [ "$status" = 200 ]
}
start() {
  docker compose up --detach --no-build --wait --wait-timeout "$timeout" app && healthy && public_healthy
}

# Everything is checked before anything is stopped.
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$ ]] || fail 'invalid image reference.'
[[ "$timeout" =~ ^[1-9][0-9]{0,4}$ ]] || fail 'the health timeout must be positive seconds.'
[[ "$backup" = 0 || "$backup" = 1 ]] || fail 'backup must be 0 or 1.'
[[ "$require_rootless" = true || "$require_rootless" = false ]] || fail 'REQUIRE_ROOTLESS must be true or false.'
[[ "$require_public_health" = true || "$require_public_health" = false ]] || fail 'REQUIRE_PUBLIC_HEALTH must be true or false.'
[ -z "$docker_host" ] || [ -z "$docker_context" ] || fail 'select a Docker socket or context, not both.'
[ -z "$docker_host" ] || [[ "$docker_host" =~ ^unix:///[-a-zA-Z0-9_./]+$ ]] || fail 'Docker host must be an explicit local Unix socket.'
[ -z "$docker_context" ] || [[ "$docker_context" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'invalid Docker context.'
[ "$require_rootless" != true ] || [ -n "$docker_host$docker_context" ] || fail 'select a rootless Docker socket or context explicitly.'
# Pin the endpoint BEFORE the first Docker invocation. A context overrides DOCKER_HOST, so clear
# its ambient value when a socket was selected. Never discover/fall back to a different daemon.
if [ -n "$docker_host" ]; then
  unset DOCKER_CONTEXT
  export DOCKER_HOST="$docker_host"
else
  unset DOCKER_HOST
  export DOCKER_CONTEXT="${docker_context:-default}"
fi
if [ "$require_rootless" = true ]; then
  security="$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null)" || fail 'the selected rootless Docker endpoint is unavailable.'
  [[ "$security" =~ \"name=rootless\" ]] || fail 'the selected Docker endpoint is not rootless; deployment refused.'
fi
docker compose version >/dev/null 2>&1 || fail "the server needs Docker with the Compose plugin (docker compose version)."
case "$(docker compose up --help 2>&1)" in
  *--wait-timeout*) ;;
  *) fail "the server needs Docker Compose 2.17 or later (docker compose version)." ;;
esac
if [ ! -f .env ] || ! grep -q '^PUBLIC_ORIGIN=.' .env; then
  fail "create $PWD/.env with PUBLIC_ORIGIN=https://<the site's address> first (docs/DEPLOYMENT.md)."
fi
if [ "$require_public_health" = true ] && [ -z "$health_url" ]; then
  origin="$(setting PUBLIC_ORIGIN)"
  # Accept literal unquoted or quoted dotenv values; never source the operator's .env as code.
  case "$origin" in \"*\") origin="${origin:1:${#origin}-2}" ;; \'*\') origin="${origin:1:${#origin}-2}" ;; esac
  health_url="${origin%/}/api/health"
fi
if [ -n "$health_url" ]; then
  [[ "$health_url" =~ ^https://[^/@?#[:space:]]+([/?][^[:space:]]*)?$ ]] || fail 'PUBLIC_HEALTH_URL must be an HTTPS URL without credentials.'
  command -v curl >/dev/null 2>&1 || fail 'curl is required for the public HTTPS health check.'
fi
password=""
[ -z "$registry_user" ] || password="$(cat)"

# One deployment at a time.
exec 9> .deploy.lock
flock -n 9 || fail "another deployment is running in $PWD."
# From here the deployment carries on if the SSH session drops (a cancelled job, a lost runner,
# Ctrl-C): hang-ups are ignored, and all output goes through tee, which keeps writing deploy.log
# once the session is gone, so no command dies of a broken pipe. It finishes or goes back here.
trap '' HUP
if tee -p </dev/null >/dev/null 2>&1; then exec > >(tee -p -a deploy.log) 2>&1; fi
say "$(date -u +%Y-%m-%dT%H:%M:%SZ) deploying $image"
# The project name keeps the data volume's name, whatever this folder is called.
grep -q '^COMPOSE_PROJECT_NAME=' .env || add_setting COMPOSE_PROJECT_NAME bangla-adventures
container="$(docker compose ps --all --quiet app)"
previous="$(setting APP_IMAGE)"
# An app first started by hand (docker compose up) has no APP_IMAGE yet: go back to its container's.
if [ -z "$previous" ] && [ -n "$container" ]; then
  previous="$(docker inspect --format '{{.Config.Image}}' "$container")"
fi

if [ -n "$registry_user" ]; then
  say "pulling $image"
  # The registry is the first part of the name when it looks like a host (ghcr.io/...); else Docker Hub.
  registry="${image%%/*}"
  case "$registry" in
    docker.io|index.docker.io) registry=https://index.docker.io/v1/ ;;
    *.*|*:*|localhost) ;;
    *) registry=https://index.docker.io/v1/ ;;
  esac
  # The explicit DOCKER_HOST/DOCKER_CONTEXT above survives this temporary registry config.
  config="${DOCKER_CONFIG:-$HOME/.docker}"
  # A private credentials folder for this pull only, so the sign-in is not kept on the server. The
  # file is written here directly: docker login could hand the password to a credential helper.
  login="$(mktemp -d)"
  trap 'rm -rf "$login"' EXIT
  for part in cli-plugins contexts; do
    [ ! -d "$config/$part" ] || ln -s "$config/$part" "$login/$part"
  done
  auth="$(printf '%s:%s' "$registry_user" "$password" | b64)"
  (umask 077; printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$registry" "$auth" > "$login/config.json")
  unset password auth
  DOCKER_CONFIG="$login" docker pull "$image" || fail "could not pull $image with the registry sign-in given."
  rm -rf "$login"
elif docker image inspect "$image" >/dev/null 2>&1; then
  say "$image is already on this server, so it is used without pulling."
else
  say "pulling $image"
  docker pull "$image"
fi

# The backup needs the app's database; a throwaway container checks for it. Both run the current
# image (the one found above, also when .env does not name it).
if [ "$backup" != 1 ]; then
  say "no backup: backups are turned off (DEPLOY_BACKUP=0)."
elif [ -z "$container" ]; then
  say "no backup: the app has not been started here yet."
elif [ "$(APP_IMAGE="$previous" docker compose run --rm --no-deps -T --entrypoint sh app \
  -c 'test -f "$DATABASE_PATH" || echo none')" = none ]; then
  say "no backup: the app has no database yet."
else
  mkdir -p backups
  # The app's user (uid 1000) writes the archives; nobody else may read them.
  docker run --rm --user root --entrypoint sh --volume "$PWD/backups:/backups" "$image" \
    -c 'chown 1000:1000 /backups && chmod 0700 /backups'
  say "stopping the app for a consistent backup"
  docker compose stop app
  if ! APP_IMAGE="$previous" docker compose run --rm --no-deps --volume "$PWD/backups:/backups" app \
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
  say "restoring previous image $previous (database and media are not restored)"
  start || fail "$image failed its health checks; the previous image was selected but also failed health checks." \
    "Check docker compose ps, logs and the HTTPS proxy in $PWD; database and media were not restored."
  fail "$image failed its health checks; $previous is running again. Database and media were not restored."
fi
fail "$image did not become healthy, and there is no earlier version to go back to."
