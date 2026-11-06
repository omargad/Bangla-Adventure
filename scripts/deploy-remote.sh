#!/usr/bin/env bash
# Runs on the server, in the deployment folder, for scripts/deploy.sh (or by hand, to roll back):
#
#   bash deploy-remote.sh IMAGE [REGISTRY_USER] [BACKUP=1] [HEALTH_TIMEOUT=180]
#     [DOCKER_HOST] [DOCKER_CONTEXT] [REQUIRE_ROOTLESS=true] [PUBLIC_HEALTH_URL]
#     [REQUIRE_PUBLIC_HEALTH=false] [DEPLOYMENT_DIRECTORY] [STAGING_DIRECTORY]
#
# With REGISTRY_USER, the registry password is read from standard input. The folder holds
# compose.yaml and an operator-managed .env (PUBLIC_ORIGIN, optionally APP_PORT); this script
# records the running image there as APP_IMAGE. Its output is also added to deploy.log there, and
# it carries on to the end if the SSH session drops. A staged narration.env from scripts/deploy.sh
# replaces those ELEVENLABS_* settings in .env first; a failed deployment puts the previous .env back.
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
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
deployment_directory="${10:-$script_directory}"
staging_directory="${11:-}"
cd "$deployment_directory"
deployment_directory="$PWD"
# Only .env decides these: a value left in the operator's shell must not override it.
unset APP_IMAGE COMPOSE_PROJECT_NAME

say() { printf 'deploy: %s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
transaction=""
snapshot=""
login=""
committed=false
previous=""
original_image=""
had_compose=false
had_script=false
narration=""
narration_names=()
narration_values=()
saved_env=false
env_temporary=""
# Staging belongs only to this invocation. Never clean a caller-selected unrelated directory.
if [ -n "$staging_directory" ]; then
  [ ! -L "$staging_directory" ] && [ -d "$staging_directory" ] || fail 'invalid staging directory.'
  staging_directory="$(cd "$staging_directory" && pwd -P)"
  [ "${staging_directory%/*}" = "$deployment_directory" ] && \
    [[ "${staging_directory##*/}" =~ ^\.deploy-stage\.[a-zA-Z0-9]+$ ]] && \
    [ "$script_directory" = "$staging_directory" ] || fail 'staging directory must be this release inside the deployment directory.'
  trap 'rm -rf -- "$staging_directory"' EXIT
  for artifact in compose.yaml deploy-remote.sh; do
    [ -f "$staging_directory/$artifact" ] && [ ! -L "$staging_directory/$artifact" ] || fail 'staged release files must be regular files.'
  done
  if [ -e "$staging_directory/narration.env" ] || [ -L "$staging_directory/narration.env" ]; then
    narration="$staging_directory/narration.env"
    [ -f "$narration" ] && [ ! -L "$narration" ] || fail 'staged release files must be regular files.'
  fi
fi
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }
# The shapes scripts/deploy.sh accepts. Compose would expand a $ in .env; quotes, backslashes and
# spaces never belong in a key.
valid_narration() {
  local LC_ALL=C
  case "$1" in
    ELEVENLABS_API_KEY) [[ "$2" =~ ^[[:graph:]]{20,200}$ && "$2" != *[\"\'\\\$\`]* ]] ;;
    ELEVENLABS_VOICE_ID) [[ "$2" =~ ^[A-Za-z0-9]{10,40}$ ]] ;;
    ELEVENLABS_MODEL_ID) [[ "$2" =~ ^[a-z0-9_]{3,40}$ ]] ;;
    ELEVENLABS_DAILY_CHARACTER_LIMIT) [[ "$2" =~ ^[1-9][0-9]{0,8}$ ]] ;;
    *) return 1 ;;
  esac
}
# Replaces every NAME= line of the staged names (a later duplicate would otherwise win) and appends
# the missing ones, keeping all other lines. Values stay inside this shell: no command line holds
# one. The private new file replaces .env in one rename.
write_narration() {
  local line name index content="" replaced=" "
  while IFS= read -r line || [ -n "$line" ]; do
    name="${line%%=*}"
    for index in "${!narration_names[@]}"; do
      if [ "$name" != "$line" ] && [ "$name" = "${narration_names[$index]}" ]; then
        line="$name=${narration_values[$index]}"
        replaced+="$name "
      fi
    done
    content+="$line"$'\n'
  done < .env
  for index in "${!narration_names[@]}"; do
    [[ "$replaced" = *" ${narration_names[$index]} "* ]] || content+="${narration_names[$index]}=${narration_values[$index]}"$'\n'
  done
  env_temporary="$(mktemp "$PWD/.env.XXXXXXXXXX")" && printf '%s' "$content" > "$env_temporary" && \
    chmod 600 "$env_temporary" && mv -f "$env_temporary" .env && env_temporary=""
}
# Puts back the .env saved before the narration settings changed it.
restore_settings() {
  [ "$saved_env" = true ] || return 0
  cp -p "$snapshot/.env" .env.restore && mv -f .env.restore .env
}
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
restore_configuration() {
  local artifact existed
  restore_settings || return 1
  for artifact in compose.yaml deploy-remote.sh; do
    if [ "$artifact" = compose.yaml ]; then existed="$had_compose"; else existed="$had_script"; fi
    if [ "$existed" = true ]; then
      cp -p "$transaction/$artifact" "$artifact.restore" && mv -f "$artifact.restore" "$artifact" || return 1
    else
      rm -f "$artifact" || return 1
    fi
  done
}
rollback_release() {
  if [ -n "$previous" ]; then
    say "restoring previous image $previous and its deployment configuration (database and media are not restored)"
    restore_configuration && set_setting APP_IMAGE "$previous" && start || {
      say 'the previous release could not be restored to health; operator intervention is required.' >&2
      return 1
    }
  else
    # A failed first release has no known-good image/configuration to restart.
    if [ -f compose.yaml ]; then docker compose stop app || return 1; fi
    restore_configuration || return 1
    if [ -n "$original_image" ]; then set_setting APP_IMAGE "$original_image"; else sed -i '/^APP_IMAGE=/d' .env; fi || {
      say 'could not restore APP_IMAGE in the server settings; operator intervention is required.' >&2
      return 1
    }
    say 'the first release failed; no previous release exists. Staged deployment configuration was removed.' >&2
  fi
}
finish() {
  local result=$?
  local keep_snapshot=false
  trap - EXIT
  if [ -n "$transaction" ] && [ "$committed" != true ]; then
    if ! rollback_release; then
      result=1
      keep_snapshot=true
      say "saved deployment configuration remains in $transaction for recovery." >&2
    fi
  elif [ "$committed" != true ] && ! restore_settings; then
    # Failed before the release files were saved: only .env had changed.
    result=1
    keep_snapshot=true
    say "the previous .env could not be restored; it remains in $snapshot for recovery." >&2
  fi
  [ -z "$env_temporary" ] || rm -f -- "$env_temporary"
  [ -z "$transaction" ] || rm -f -- compose.yaml.incoming deploy-remote.sh.incoming
  [ -z "$login" ] || rm -rf -- "$login"
  [ -z "$snapshot" ] || [ "$keep_snapshot" = true ] || rm -rf -- "$snapshot"
  [ -z "$staging_directory" ] || rm -rf -- "$staging_directory"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
# The same lock protects all live-file reads, promotion, backup, start and rollback. Uploads are
# isolated in a unique staging directory, so a rejected attempt cannot alter the active release.
exec 9> .deploy.lock
flock -n 9 || fail "another deployment is running in $PWD."
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
# Staged narration settings: NAME=VALUE lines of known names, each once. Read, then deleted at once.
if [ -n "$narration" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    name="${line%%=*}"
    [ "$name" != "$line" ] && valid_narration "$name" "${line#*=}" && \
      [[ " ${narration_names[*]-} " != *" $name "* ]] || fail 'the staged narration settings are invalid.'
    narration_names+=("$name")
    narration_values+=("${line#*=}")
  done < "$narration"
  unset line
  rm -f -- "$narration"
  [ "${#narration_names[@]}" -gt 0 ] || fail 'the staged narration settings are invalid.'
fi
password=""
[ -z "$registry_user" ] || password="$(cat)"
# From here the deployment carries on if the SSH session drops (a cancelled job, a lost runner,
# Ctrl-C): hang-ups are ignored, and all output goes through tee, which keeps writing deploy.log
# once the session is gone, so no command dies of a broken pipe. It finishes or goes back here.
trap '' HUP
if tee -p </dev/null >/dev/null 2>&1; then exec > >(tee -p -a deploy.log) 2>&1; fi
say "$(date -u +%Y-%m-%dT%H:%M:%SZ) deploying $image"
# The project name keeps the data volume's name, whatever this folder is called.
grep -q '^COMPOSE_PROJECT_NAME=' .env || add_setting COMPOSE_PROJECT_NAME bangla-adventures
# Narration settings change .env only after a private copy is saved, so Compose validates and starts
# with them. Every failure before the release is committed puts that copy back.
if [ "${#narration_names[@]}" -gt 0 ]; then
  snapshot="$(mktemp -d "$PWD/.deploy-transaction.XXXXXXXXXX")"
  cp -p .env "$snapshot/.env"
  saved_env=true
  say "updating ${narration_names[*]} in .env"
  write_narration || fail 'could not update the narration settings in .env.'
fi
candidate_compose="${staging_directory:-$PWD}/compose.yaml"
docker compose --project-directory "$PWD" -f "$candidate_compose" config --quiet || fail 'the incoming Compose configuration is invalid.'
if [ -f compose.yaml ]; then
  container="$(docker compose ps --all --quiet app)"
else
  # First release: use the same project directory/.env without installing candidate files yet.
  container="$(docker compose --project-directory "$PWD" -f "$candidate_compose" ps --all --quiet app)"
  [ -z "$container" ] || fail 'an existing app has no saved Compose configuration; recover it before deploying.'
fi
previous="$(setting APP_IMAGE)"
original_image="$previous"
[ -f compose.yaml ] || [ -z "$previous" ] || fail 'APP_IMAGE exists without saved Compose configuration; recover that configuration before deploying.'
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

# Save the release files only after preflight/pull succeed (the snapshot may already hold .env).
# The trap restores them on every later failure, including a stopped app, promotion error or
# failed health check.
[ -n "$snapshot" ] || snapshot="$(mktemp -d "$PWD/.deploy-transaction.XXXXXXXXXX")"
if [ -f compose.yaml ]; then cp -p compose.yaml "$snapshot/compose.yaml"; had_compose=true; fi
if [ -f deploy-remote.sh ]; then cp -p deploy-remote.sh "$snapshot/deploy-remote.sh"; had_script=true; fi
transaction="$snapshot"

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
    fail "the backup failed; restoring the current release without promoting the candidate."
  fi
fi

if [ -n "$staging_directory" ]; then
  for artifact in compose.yaml deploy-remote.sh; do
    cp -p "$staging_directory/$artifact" "$artifact.incoming" && mv -f "$artifact.incoming" "$artifact" || fail "could not install $artifact; restoring the previous release."
  done
fi
set_setting APP_IMAGE "$image"
say "starting $image"
if start; then
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$image" >> deployments.log
  committed=true
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
fail "$image failed its health checks; rolling back the image and deployment configuration. Database and media are not restored."
