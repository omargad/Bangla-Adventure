#!/usr/bin/env bash
# Restore only to a new directory; never overwrite application state.
set -euo pipefail
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/backup_restore.py" restore "$@"
