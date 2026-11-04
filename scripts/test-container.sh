#!/usr/bin/env bash
# Uses only newly-created, uniquely-named Docker volumes. Never point this
# smoke test at production data. It removes only the resources it creates.
set -euo pipefail

IMAGE="${1:-bangla-adventures:ci}"
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker info >/dev/null
scratch="$(mktemp -d -t bangla-container-smoke.XXXXXXXX)"
volume="$(basename "$scratch")"
root_volume="${volume}-root"
read_only_volume="${volume}-read-only"
created_volumes=""
container_id=""

cleanup() {
  status=$?
  if [ -n "$container_id" ]; then
    if [ "$status" -ne 0 ]; then docker logs "$container_id" >&2 || true; fi
    docker rm -f "$container_id" >/dev/null || true
  fi
  for created in $created_volumes; do docker volume rm "$created" >/dev/null || true; done
  rmdir "$scratch" || true
  exit "$status"
}
trap cleanup EXIT

# new_volume NAME: creates the volume, refusing to reuse one that already exists.
new_volume() {
  if docker volume inspect "$1" >/dev/null 2>&1; then
    echo "Refusing to reuse an existing volume: $1" >&2
    exit 1
  fi
  docker volume create "$1" >/dev/null
  created_volumes="$created_volumes $1"
}

# start_container VOLUME [docker run options]: as compose.yaml runs it unless options say otherwise.
# An empty VOLUME starts it without one, on the container's own filesystem.
start_container() {
  data_volume="$1"; shift
  [ "$#" -gt 0 ] || set -- --user node --security-opt no-new-privileges:true --cap-drop ALL
  [ -z "$data_volume" ] || set -- --mount "type=volume,source=$data_volume,target=/app/.data" "$@"
  container_id="$(docker run --detach \
    --env PUBLIC_ORIGIN=https://bangla-container-test.example \
    --env NEXT_TELEMETRY_DISABLED=1 \
    "$@" "$IMAGE")"
  for attempt in $(seq 1 60); do
    state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
    if [ "$state" != "running" ]; then
      echo "Container stopped before becoming healthy: $state" >&2
      return 1
    fi
    health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
    if [ "$health" = "healthy" ]; then return 0; fi
    if [ "$health" = "unhealthy" ]; then
      echo "Container health check failed." >&2
      return 1
    fi
    sleep 2
  done
  echo "Timed out waiting for container readiness." >&2
  return 1
}

# stop_container: stops it as hosts do (SIGTERM), checks that Next itself shut down cleanly, removes it.
stop_container() {
  docker stop --time 30 "$container_id" >/dev/null
  exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$container_id")"
  logs="$(docker logs "$container_id" 2>&1)"
  if [ "$exit_code" != 143 ] || [[ "$logs" == *"npm error"* ]]; then
    echo "The app did not shut down cleanly on SIGTERM (exit code $exit_code, expected 143)." >&2
    exit 1
  fi
  docker rm "$container_id" >/dev/null
  container_id=""
}

# expect_health_ok: /api/health answers 200 from inside the container, as its own user.
expect_health_ok() {
  code="$(docker exec "$container_id" node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>console.log(r.status),()=>console.log('none'))")"
  if [ "$code" != 200 ]; then
    echo "/api/health answered $code, not 200." >&2
    exit 1
  fi
}

# expect_start_failure TEXT [docker run options]: the container must stop at once with an error that says TEXT.
expect_start_failure() {
  expected="$1"; shift
  container_id="$(docker run --detach --env PUBLIC_ORIGIN=https://bangla-container-test.example "$@" "$IMAGE")"
  exit_code="$(timeout 60 docker wait "$container_id" || echo running)"
  logs="$(docker logs "$container_id" 2>&1)"
  if [ "$exit_code" = 0 ] || [ "$exit_code" = running ] || [[ "$logs" != *"$expected"* ]]; then
    echo "Expected a quick failure that says '$expected' (exit code $exit_code)." >&2
    exit 1
  fi
  docker rm "$container_id" >/dev/null
  container_id=""
}

new_volume "$volume"
start_container "$volume"
docker exec --user node -i "$container_id" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
assert.notEqual(process.getuid(), 0, 'application must run as a non-root user');
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='adults'").get(), 'health check must initialize the application schema');
db.exec('CREATE TABLE container_smoke_probe (value TEXT NOT NULL)');
db.prepare('INSERT INTO container_smoke_probe (value) VALUES (?)').run('persistent database');
db.close();
fs.mkdirSync(process.env.MEDIA_ROOT, { recursive: true });
fs.writeFileSync(path.join(process.env.MEDIA_ROOT, 'container-smoke.txt'), 'persistent media');
NODE
docker exec --user node "$container_id" python3 scripts/backup_restore.py --help >/dev/null
# Server commands must run inside the image: an unknown address proves each one loads and reaches the database.
for server_command in admin:grant admin:reset-password; do
  server_output="$(docker exec --user node "$container_id" npm run --silent "$server_command" -- missing-owner@example.com 2>&1 || true)"
  if ! printf '%s' "$server_output" | grep -q "No active account matched"; then
    echo "$server_command could not run in the image:" >&2
    printf '%s\n' "$server_output" >&2
    exit 1
  fi
done

# Recreate the container, not just its process, to prove persistence is provided
# by the named volume rather than the disposable writable container layer.
stop_container
start_container "$volume"
docker exec --user node -i "$container_id" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
assert.equal(db.prepare('SELECT value FROM container_smoke_probe').get().value, 'persistent database');
assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
db.close();
assert.equal(fs.readFileSync(path.join(process.env.MEDIA_ROOT, 'container-smoke.txt'), 'utf8'), 'persistent media');
NODE

# Hosts such as Railway and Render attach a disk owned by root and start the container as root.
# The start script must hand the disk to node and run the app as node.
stop_container
new_volume "$root_volume"
docker run --rm --user root --entrypoint sh --mount "type=volume,source=$root_volume,target=/app/.data" "$IMAGE" \
  -c 'chown -R root:root /app/.data && chmod 0755 /app/.data'
start_container "$root_volume" --security-opt no-new-privileges:true
app_uid="$(docker exec "$container_id" sh -c "awk '/^Uid:/ { print \$2 }' /proc/1/status")"
node_uid="$(docker exec "$container_id" id -u node)"
if [ "$app_uid" != "$node_uid" ]; then
  echo "On a root-owned disk the app runs as uid $app_uid, not node ($node_uid)." >&2
  exit 1
fi
owner="$(docker exec "$container_id" stat -c %U /app/.data /app/.data/bangla-adventures.db | sort -u)"
if [ "$owner" != "node" ]; then
  echo "The root-owned disk was not handed to node: $owner" >&2
  exit 1
fi
stop_container

# OpenShift runs the container as an arbitrary uid in group 0; here also without a volume.
start_container "" --user 1000680000:0 --security-opt no-new-privileges:true --cap-drop ALL
expect_health_ok
stop_container

# Root without the capabilities to switch to node (Kubernetes drop ALL without runAsUser) must
# stop at once and say what to set. A data folder at the app's own root must be refused.
expect_start_failure "runAsUser: 1000" --user root --cap-drop ALL
expect_start_failure "cannot be a data folder" --user root --env DATABASE_PATH=/app/bangla.db

# A read-only root filesystem with a writable /tmp and a data volume (Kubernetes
# readOnlyRootFilesystem): the app and the tsx-based server commands must both work.
new_volume "$read_only_volume"
start_container "$read_only_volume" --read-only --tmpfs /tmp --user node --security-opt no-new-privileges:true --cap-drop ALL
expect_health_ok
docker exec -i "$container_id" node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
db.prepare("INSERT INTO adults (id, email, display_name, password_hash, approval_status) VALUES (?, ?, ?, ?, 'pending')")
  .run('container-smoke-owner', 'owner@bangla-container-test.example', 'Container smoke owner', 'not-a-password-hash');
db.close();
NODE
if ! grant_output="$(docker exec "$container_id" npm run --silent admin:grant -- owner@bangla-container-test.example 2>&1)"; then
  echo "admin:grant failed on a read-only root filesystem:" >&2
  printf '%s\n' "$grant_output" >&2
  exit 1
fi
docker exec -i "$container_id" node - <<'NODE'
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { readonly: true });
assert.equal(db.prepare("SELECT role FROM adults WHERE id = 'container-smoke-owner'").get().role, 'admin');
db.close();
NODE
stop_container

echo "Container smoke passed: non-root startup, fresh SQLite schema, backup utility, database/media persistence, a root-owned disk handed to node, clean SIGTERM shutdown, an arbitrary uid in group 0, a clear error for root without capabilities or a data folder at /app, and a read-only root filesystem."
