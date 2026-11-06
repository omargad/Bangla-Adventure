#!/usr/bin/env bash
# Installs or updates only the six named production user-systemd units and their two tools.
set -euo pipefail
set +x
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/production-ops-install.py" "$@"
