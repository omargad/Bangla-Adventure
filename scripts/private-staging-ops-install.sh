#!/usr/bin/env bash
# Installs only the four named user-systemd units for existing private staging.
set -euo pipefail
set +x
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/private-staging-ops-install.py" "$@"
