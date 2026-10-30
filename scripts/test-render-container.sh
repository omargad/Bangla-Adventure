#!/usr/bin/env bash
# Runs the Render image (Dockerfile.render) the way Render does: PORT=10000 and a
# persistent disk at /app/.data that starts empty and owned by root. Uses only a
# new temporary directory as that disk. Never point this smoke test at production
# data. It removes only the resources it creates.
set -euo pipefail

IMAGE="${1:-bangla-adventures-render:ci}"
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker info >/dev/null
scratch="$(mktemp -d -t bangla-render-smoke.XXXXXXXX)"
disk="$scratch/disk"
disk_created=0
container_id=""

# The disk ends up holding files owned by the image's node user, so it is created
# and removed by root inside a throwaway container of the same image.
as_root() {
  docker run --rm --network none --user root \
    --mount "type=bind,source=$scratch,target=/scratch" \
    --entrypoint "$1" "$IMAGE" "${@:2}"
}

cleanup() {
  status=$?
  if [ -n "$container_id" ]; then
    if [ "$status" -ne 0 ]; then docker logs "$container_id" >&2 || true; fi
    docker rm -f "$container_id" >/dev/null || true
  fi
  if [ "$disk_created" -eq 1 ]; then as_root rm -rf /scratch/disk || true; fi
  rmdir "$scratch" || true
  exit "$status"
}
trap cleanup EXIT

disk_created=1
as_root install -d -o root -g root -m 0755 /scratch/disk

# Not --cap-drop ALL: the start script needs root's CHOWN, SETUID and SETGID to
# hand the disk to node and drop to it. no-new-privileges does not stop that drop.
start_container() {
  container_id="$(docker run --detach \
    --mount "type=bind,source=$disk,target=/app/.data" \
    --env PORT=10000 \
    --env PUBLIC_ORIGIN=https://bangla-container-test.example \
    --env NEXT_TELEMETRY_DISABLED=1 \
    --security-opt no-new-privileges:true \
    "$IMAGE")"
  for _ in $(seq 1 60); do
    state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
    if [ "$state" != "running" ]; then
      echo "Container stopped before /api/health answered: $state" >&2
      return 1
    fi
    if docker exec "$container_id" node -e "fetch('http://127.0.0.1:10000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for /api/health on port 10000." >&2
  return 1
}

# The Next.js server, the disk, the database and media must all belong to node.
check_runs_as_node() {
  docker exec -i "$container_id" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const nodeUid = Number(execFileSync('id', ['-u', 'node'], { encoding: 'utf8' }));
assert.notEqual(nodeUid, 0);
const cmdline = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; } };
const servers = fs.readdirSync('/proc').filter((pid) => /^\d+$/.test(pid) && Number(pid) !== process.pid && /next/.test(cmdline(pid)));
assert.ok(servers.length > 0, 'no Next.js server process found');
for (const pid of servers) {
  const uids = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Uid:\s+(.*)$/m)[1].split(/\s+/).map(Number);
  assert.deepEqual(uids, [nodeUid, nodeUid, nodeUid, nodeUid], `process ${pid} (${cmdline(pid).replace(/\0/g, ' ').trim()}) must run as node, not root`);
}
for (const file of ['/app/.data', process.env.DATABASE_PATH, process.env.MEDIA_ROOT]) {
  assert.equal(fs.statSync(file).uid, nodeUid, `${file} must belong to node`);
}
NODE
}

start_container
check_runs_as_node
docker exec -i "$container_id" scripts/render-run-as-app.sh node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
assert.notEqual(process.getuid(), 0, 'render-run-as-app.sh must drop root');
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='adults'").get(), 'health check must initialize the application schema');
db.exec('CREATE TABLE render_smoke_probe (value TEXT NOT NULL)');
db.prepare('INSERT INTO render_smoke_probe (value) VALUES (?)').run('persistent database');
db.close();
fs.writeFileSync(path.join(process.env.MEDIA_ROOT, 'render-smoke.txt'), 'persistent media');
NODE

# What the Render Shell instructions in docs/DEPLOYMENT.md run.
for server_command in admin:grant admin:reset-password; do
  server_output="$(docker exec "$container_id" scripts/render-run-as-app.sh npm run --silent "$server_command" -- missing-owner@example.com 2>&1 || true)"
  if ! printf '%s' "$server_output" | grep -q "No active account matched"; then
    echo "$server_command could not run through render-run-as-app.sh:" >&2
    printf '%s\n' "$server_output" >&2
    exit 1
  fi
done
backup_output="$(docker exec "$container_id" scripts/render-run-as-app.sh bash scripts/backup.sh /app/.data/backups 3 --application-stopped)"
if ! printf '%s' "$backup_output" | grep -q '"verified": true'; then
  echo "The backup did not verify:" >&2
  printf '%s\n' "$backup_output" >&2
  exit 1
fi
check_backups_owned_by_node() {
  docker exec -i "$container_id" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const nodeUid = Number(execFileSync('id', ['-u', 'node'], { encoding: 'utf8' }));
const walk = (dir) => [dir, ...fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])];
const files = walk('/app/.data/backups');
assert.ok(files.some((file) => /^bangla-data-.*\.tar\.gz$/.test(path.basename(file))), `no archive in ${files.join(', ')}`);
for (const file of files) assert.equal(fs.lstatSync(file).uid, nodeUid, `${file} must belong to node`);
NODE
}
check_backups_owned_by_node

# Recreate the container on the same disk, as a Render deploy does, to prove the
# data lives on the disk and a second start finds it already owned by node.
docker stop --time 30 "$container_id" >/dev/null
docker rm "$container_id" >/dev/null
container_id=""
start_container
check_runs_as_node
check_backups_owned_by_node
docker exec -i "$container_id" scripts/render-run-as-app.sh node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
assert.equal(db.prepare('SELECT value FROM render_smoke_probe').get().value, 'persistent database');
assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
db.close();
assert.equal(fs.readFileSync(path.join(process.env.MEDIA_ROOT, 'render-smoke.txt'), 'utf8'), 'persistent media');
NODE
echo "Render container smoke passed: root-owned disk handed to node, server on port 10000 as node, admin:grant, admin:reset-password and backup as node, and database/media persistence."
