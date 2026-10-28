#!/usr/bin/env bash
# Uses only a newly-created, uniquely-named Docker volume. Never point this
# smoke test at production data. It removes only the resources it creates.
set -euo pipefail

IMAGE="${1:-bangla-adventures:ci}"
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker info >/dev/null
scratch="$(mktemp -d -t bangla-container-smoke.XXXXXXXX)"
volume="$(basename "$scratch")"
volume_created=0
container_id=""

cleanup() {
  status=$?
  if [ -n "$container_id" ]; then
    if [ "$status" -ne 0 ]; then docker logs "$container_id" >&2 || true; fi
    docker rm -f "$container_id" >/dev/null || true
  fi
  if [ "$volume_created" -eq 1 ]; then docker volume rm "$volume" >/dev/null || true; fi
  rmdir "$scratch" || true
  exit "$status"
}
trap cleanup EXIT

if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing volume: $volume" >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
volume_created=1

start_container() {
  container_id="$(docker run --detach \
    --mount "type=volume,source=$volume,target=/app/.data" \
    --env PUBLIC_ORIGIN=https://bangla-container-test.example \
    --env NEXT_TELEMETRY_DISABLED=1 \
    --security-opt no-new-privileges:true --cap-drop ALL \
    "$IMAGE")"
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

start_container
docker exec -i "$container_id" node - <<'NODE'
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
docker exec "$container_id" python3 scripts/backup_restore.py --help >/dev/null

# Recreate the container, not just its process, to prove persistence is provided
# by the named volume rather than the disposable writable container layer.
docker stop --time 30 "$container_id" >/dev/null
docker rm "$container_id" >/dev/null
container_id=""
start_container
docker exec -i "$container_id" node - <<'NODE'
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
echo "Container smoke passed: non-root startup, fresh SQLite schema, backup utility, and database/media persistence."
