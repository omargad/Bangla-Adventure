#!/bin/sh
# Starts the app as the unprivileged `node` user wherever the image runs.
# Docker Compose and the CI smoke test start the container as `node` already (compose.yaml sets
# `user: node`), so this only starts the app. Hosts that attach the persistent disk owned by root
# (Railway, Render and similar) start the container as root instead: the data folders are then
# handed to `node` and the app is started as `node`, so it can write its database and media.
set -eu
if [ "$(id -u)" = 0 ]; then
  for dir in "$(dirname "${DATABASE_PATH:-/app/.data/bangla-adventures.db}")" "${MEDIA_ROOT:-/app/.data/media}"; do
    mkdir -p "$dir"
    # Only what is not node's already, so a large disk is not walked file by file on every start.
    find "$dir" ! -user node -exec chown node:node {} +
  done
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
