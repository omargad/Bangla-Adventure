#!/bin/sh
# Start command for Dockerfile.render. Render mounts the persistent disk at
# /app/.data owned by root; give it to the unprivileged `node` user, then run the
# app as `node` with no extra privileges. Never used by ./Dockerfile or Compose.
set -eu
data_dir="$(dirname "${DATABASE_PATH:-/app/.data/bangla-adventures.db}")"
media_dir="${MEDIA_ROOT:-/app/.data/media}"
mkdir -p "$data_dir" "$media_dir"
if [ "$(stat -c %u "$data_dir")" != "$(id -u node)" ]; then chown -R node:node "$data_dir"; fi
if [ "$(stat -c %u "$media_dir")" != "$(id -u node)" ]; then chown -R node:node "$media_dir"; fi
exec /app/scripts/render-run-as-app.sh node node_modules/next/dist/bin/next start
