#!/usr/bin/env bash
# Fixed private-staging operations only. No environment-file or arbitrary command hooks.
set -euo pipefail
set +x
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/private-staging-ops.py" "$@"
