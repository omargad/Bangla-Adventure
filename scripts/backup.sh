#!/usr/bin/env bash
# Snapshot configured SQLite/media. See docs/BACKUP_RESTORE.md.
set -euo pipefail
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/backup_restore.py" backup "$@"
