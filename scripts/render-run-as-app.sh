#!/bin/sh
# Run a command as the app's `node` user with no added privileges. Use it in the
# Render Shell for anything that touches the database, so new files stay owned
# by `node`, for example:
#   scripts/render-run-as-app.sh npm run admin:grant -- you@example.com
#   scripts/render-run-as-app.sh npm run admin:reset-password -- you@example.com
set -eu
[ "$#" -gt 0 ] || { echo "Usage: scripts/render-run-as-app.sh <command> [args...]" >&2; exit 64; }
if [ "$(id -u)" = "$(id -u node)" ]; then exec "$@"; fi
exec setpriv --reuid=node --regid=node --init-groups --no-new-privs env HOME=/home/node "$@"
