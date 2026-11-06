#!/usr/bin/env bash
# Fixed production operations only: backup, monitor, offsite or status. No arbitrary command hooks.
set -euo pipefail
set +x
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/production-ops.py" "$@"
