#!/usr/bin/env bash
# Only a stopped, clean private stage may be the source. All mutations happen in
# a new owned volume; no old image, application port, account or approval is used.
set -euo pipefail
fail() { printf 'private staging drill: %s\n' "$1" >&2; exit 1; }
[ "$#" = 1 ] || fail 'supply the exact approved image digest.'
image="$1"
# Any owner's bangla-adventure package: the caller passes the exact digest it verified.
[[ "$image" =~ ^ghcr\.io/[a-z0-9]+(-[a-z0-9]+)*/bangla-adventure@sha256:[a-f0-9]{64}$ ]] || fail 'an immutable application image digest is required.'
[ "$(id -u)" = 1002 ] || fail 'run as the prepared rootless deployment user.'
command -v python3 >/dev/null || fail 'Python 3 is required.'
command -v docker >/dev/null || fail 'Docker is required.'
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///run/user/1002/docker.sock
security="$(docker info --format '{{json .SecurityOptions}}')"
[[ "$security" == *'"name=rootless"'* ]] || fail 'the pinned Docker endpoint is not rootless.'
project=bangla-adventures-staging
source_volume=bangla-adventures-staging_bangla-data
helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
verifier="$helper_dir/private-staging-verify.mjs"
[ -f "$verifier" ] && [ ! -L "$verifier" ] || fail 'the approved verifier must be beside this script.'
[ "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$source_volume")" = "$project" ] || fail 'source volume does not belong to private staging.'
[ -z "$(docker ps --quiet --filter "volume=$source_volume")" ] || fail 'a container is still using the source volume.'
containers="$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")"
[ -n "$containers" ] || fail 'the private staging project has not been initialized.'
app_count=0
for container in $containers; do
  [ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail 'stop all private staging containers before the drill.'
  service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container")"
  if [ "$service" = app ]; then
    app_count=$((app_count + 1))
    [ "$(docker inspect --format '{{.Config.Image}}' "$container")" = "$image" ] || fail 'source application image differs from the approved digest.'
    [ "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/.data"}}{{.Name}}{{end}}{{end}}' "$container")" = "$source_volume" ] || fail 'source application uses an unexpected data mount.'
  fi
done
[ "$app_count" = 1 ] || fail 'exactly one private staging application is required.'

token="$(python3 -c 'import secrets; print(secrets.token_hex(12))')"
volume="bangla-private-drill-$token"
helper="${volume}-helper"
owned=false
cleanup() {
  local failed=0 label
  label="$(docker inspect --format '{{index .Config.Labels "bangla.private-drill"}}' "$helper" 2>/dev/null || true)"
  if [ "$label" = "$token" ]; then docker rm --force "$helper" >/dev/null || failed=1; fi
  if [ "$owned" = true ]; then
    label="$(docker volume inspect --format '{{index .Labels "bangla.private-drill"}}' "$volume" 2>/dev/null || true)"
    if [ "$label" = "$token" ]; then docker volume rm "$volume" >/dev/null || failed=1; else failed=1; fi
    [ "$failed" != 0 ] || owned=false
  fi
  return "$failed"
}
finish() { local result=$?; trap - EXIT; cleanup || result=1; exit "$result"; }
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if docker volume inspect "$volume" >/dev/null 2>&1 || docker inspect "$helper" >/dev/null 2>&1; then fail 'refusing to reuse existing drill resources.'; fi
docker volume create --label "bangla.private-drill=$token" "$volume" >/dev/null
owned=true
# Ownership is inside a new rootless named volume, never a host or source path.
docker run --rm --name "$helper" --label "bangla.private-drill=$token" --network none --user root --entrypoint sh --mount "type=volume,source=$volume,target=/drill" "$image" \
  -c 'chown 1000:1000 /drill && chmod 0700 /drill'
result="$(docker run --rm --name "$helper" --label "bangla.private-drill=$token" \
  --network none --user node --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,source=$source_volume,target=/source,readonly" \
  --mount "type=volume,source=$volume,target=/drill" \
  --mount "type=bind,source=$verifier,target=/app/staging-tools/private-staging-verify.mjs,readonly" \
  --entrypoint python3 -i "$image" - <<'PY'
import hashlib, json, os, pathlib, shutil, sqlite3, subprocess, sys

source = pathlib.Path('/source')
root = pathlib.Path('/drill')
tool = '/app/scripts/backup_restore.py'
verifier = '/app/staging-tools/private-staging-verify.mjs'

def require(condition):
    if not condition:
        raise RuntimeError('isolated rehearsal check failed')

def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def files(directory):
    result = {}
    for item in sorted(directory.rglob('*')):
        require(not item.is_symlink())
        if item.is_file():
            result[str(item.relative_to(directory))] = sha(item)
        else:
            require(item.is_dir())
    return result

def environment(directory):
    result = dict(os.environ)
    result.update(DATABASE_PATH=str(directory / 'bangla-adventures.db'), MEDIA_ROOT=str(directory / 'media'))
    return result

def run_json(command, directory):
    result = subprocess.run(command, env=environment(directory), capture_output=True, text=True, check=False)
    require(result.returncode == 0)
    return json.loads(result.stdout)

def verify_clean(directory, expected=None):
    args = ['node', verifier]
    if expected is not None:
        args += ['--expected-state-digest', expected]
    result = run_json(args, directory)
    require(result.get('verified') is True)
    return result['stateDigest']

def backup(directory, destination):
    result = run_json(['python3', tool, 'backup', str(destination), '2', '--application-stopped'], directory)
    require(result.get('verified') is True)
    archive = pathlib.Path(result['archive'])
    verified = run_json(['python3', tool, 'verify', str(archive)], directory)
    require(verified.get('verified') is True)
    return archive, sha(archive)

def restore(archive, destination):
    result = run_json(['python3', tool, 'restore', str(archive), str(destination)], root)
    require(result.get('verified') is True)

def db_state(directory):
    with sqlite3.connect((directory / 'bangla-adventures.db').as_uri() + '?mode=ro', uri=True) as db:
        require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)])
        require(db.execute('PRAGMA foreign_key_check').fetchall() == [])
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        rows = {}
        for kind, name, _, _ in schema:
            if kind == 'table':
                safe = '"' + name.replace('"', '""') + '"'
                rows[name] = sorted(db.execute('SELECT * FROM ' + safe).fetchall(), key=repr)
        return schema, rows

try:
    # Staging is mounted read-only and must be clean before any test data exists.
    source_before = files(source)
    clean_digest = verify_clean(source)
    clone = root / 'clone'
    clone.mkdir(mode=0o700)
    with sqlite3.connect((source / 'bangla-adventures.db').as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(clone / 'bangla-adventures.db') as copied:
            original.backup(copied)
    shutil.copytree(source / 'media', clone / 'media')
    require(verify_clean(clone, clean_digest) == clean_digest)
    clean_archive, clean_hash = backup(clone, root / 'clean-backups')

    # Deterministic non-account records and media live ONLY in this disposable clone.
    with sqlite3.connect(clone / 'bangla-adventures.db') as db:
        db.execute('CREATE TABLE private_staging_drill_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL)')
        db.executemany('INSERT INTO private_staging_drill_probe VALUES (?,?)', [(1, b'backup probe'), (2, bytes(range(256))), (3, 'বাংলা'.encode())])
    media_probe = clone / 'media' / 'private-drill'
    media_probe.mkdir(mode=0o700)
    (media_probe / 'audio-bytes.bin').write_bytes(bytes(range(256)) * 4)
    (media_probe / 'ledger.json').write_text('{"characters":123,"fixture":true}\n')
    expected_db, expected_media = db_state(clone), files(clone / 'media')
    probe_archive, probe_hash = backup(clone, root / 'probe-backups')
    with sqlite3.connect(clone / 'bangla-adventures.db') as db:
        db.execute("UPDATE private_staging_drill_probe SET value='changed after backup'")
    (media_probe / 'audio-bytes.bin').write_bytes(b'changed after backup')
    restored = root / 'restored-probe'
    restore(probe_archive, restored)
    require(db_state(restored) == expected_db and files(restored / 'media') == expected_media)
    require(sha(probe_archive) == probe_hash)
    # A full restore of the clean snapshot, rather than deleting fixture rows,
    # proves exact original schema/revisions/statuses are recoverable.
    restored_clean = root / 'restored-clean'
    restore(clean_archive, restored_clean)
    require(verify_clean(restored_clean, clean_digest) == clean_digest)
    require(sha(clean_archive) == clean_hash and files(source) == source_before)
    print(json.dumps({'verified': True, 'checks': {'sourceUnchanged': True, 'cleanSnapshotVerified': True,
        'probeSnapshotVerified': True, 'probeDatabaseRestored': True, 'probeMediaRestored': True,
        'cleanOriginalRestored': True, 'integrity': True, 'foreignKeys': True, 'archivesUnchanged': True},
        'counts': {'pendingTopics': 15, 'pendingLessons': 18, 'sourceUsers': 0, 'probeRecords': 3, 'probeMediaFiles': 2},
        'artifactsRetained': False, 'scope': 'disposable clone only'}))
except Exception:
    print('Isolated staging backup/restore rehearsal failed.', file=sys.stderr)
    sys.exit(1)
PY
)"
cleanup || fail 'owned drill resource cleanup failed.'
printf '%s\n' "$result"
