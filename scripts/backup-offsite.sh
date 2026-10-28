#!/usr/bin/env bash
# Transfer only the newest verified archive to an operator-configured encrypted
# restic repository. This script does not initialize repositories or delete data.
set -euo pipefail
umask 077
: "${RESTIC_REPOSITORY:?Set the approved off-server restic repository}"
: "${RESTIC_PASSWORD_FILE:?Set the private restic password-file path}"
command -v restic >/dev/null || { echo 'restic is required' >&2; exit 1; }

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
archive="$(python3 - "${BACKUP_DIR:-/var/backups/bangla}" "${BACKUP_MAX_AGE_HOURS:-36}" "$RESTIC_PASSWORD_FILE" <<'PY'
from pathlib import Path
import hashlib, json, re, sys, time
directory, max_age, password_path = Path(sys.argv[1]), float(sys.argv[2]), Path(sys.argv[3])
if max_age <= 0:
    raise SystemExit('BACKUP_MAX_AGE_HOURS must be positive')
if password_path.is_symlink() or not password_path.is_file() or password_path.stat().st_mode & 0o077:
    raise SystemExit('Restic password file must be a private regular file (mode 600 or stricter)')
pattern = re.compile(r'bangla-data-\d{8}T\d{12}Z-[0-9a-f]{12}\.tar\.gz\Z')
marker = directory / '.latest-backup.json'
if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 4096:
    raise SystemExit('No valid successful-backup receipt; create a local snapshot first')
receipt = json.loads(marker.read_text())
if not isinstance(receipt, dict) or not isinstance(receipt.get('archive'), str) or not pattern.fullmatch(receipt['archive']):
    raise SystemExit('Invalid successful-backup receipt')
latest = directory / receipt['archive']
if latest.is_symlink() or not latest.is_file():
    raise SystemExit('The most recent successful archive is missing')
age = time.time() - latest.stat().st_mtime
if age < -300:
    raise SystemExit('Latest backup timestamp is in the future; correct the host clock and create a new snapshot')
if age > max_age * 3600:
    raise SystemExit('Latest local backup is stale; refusing to report an old archive as a fresh backup')
digest = hashlib.sha256()
with latest.open('rb') as source:
    for block in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(block)
if receipt.get('sha256') != digest.hexdigest():
    raise SystemExit('Latest archive no longer matches its successful-backup receipt')
print(latest.resolve())
PY
)"
python3 "$script_dir/backup_restore.py" verify "$archive" >/dev/null
exec restic backup --tag bangla-adventures -- "$archive"
