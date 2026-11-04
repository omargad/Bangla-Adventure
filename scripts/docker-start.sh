#!/bin/sh
# Starts the app as the unprivileged `node` user wherever the image runs.
# Most hosts start the container as `node` (compose.yaml sets `user: node`) or, like OpenShift,
# as an arbitrary uid in group 0: this then only checks the data folders and starts the app.
# Hosts that attach the persistent disk owned by root (Railway, Render and similar) start the
# container as root instead: the data folders are then handed to `node` and the app is started
# as `node`, so it can write its database and media.
set -eu

warn() { echo "docker-start: $*" >&2; }

# The nearest folder that exists: the path itself or its closest parent.
existing() {
  path="$1"
  while [ ! -e "$path" ]; do path="$(dirname "$path")"; done
  echo "$path"
}

# An empty setting means the default, as in the app.
data_dir="$(realpath -m "$(dirname "${DATABASE_PATH:-/app/.data/bangla-adventures.db}")")"
media_dir="$(realpath -m "${MEDIA_ROOT:-/app/.data/media}")"

# A data folder at / or /app would hand the whole app (or system) to node below.
for dir in "$data_dir" "$media_dir"; do
  case "$dir" in
    /|/app)
      warn "$dir cannot be a data folder: point DATABASE_PATH and MEDIA_ROOT inside a folder of their own, such as /app/.data"
      exit 1 ;;
  esac
done

# Warnings only: the app still starts, as some hosts offer no persistent disk.
root_device="$(stat -c %d /)"
data_at="$(existing "$data_dir")"
check_persistent() {
  at="$(existing "$1")"
  case "$(stat -f -c %T "$at")" in
    tmpfs|ramfs) warn "$1 is in memory: its files are lost when the container stops. Mount a persistent volume there." ;;
    *) [ "$(stat -c %d "$at")" != "$root_device" ] \
      || warn "$1 is not on a mounted volume: its files are lost when the container is replaced. Mount a persistent volume there." ;;
  esac
}
check_persistent "$data_dir"
# The media folder usually shares the database's disk, and one warning covers both then.
[ "$(stat -c %d "$(existing "$media_dir")")" = "$(stat -c %d "$data_at")" ] || check_persistent "$media_dir"
# Only a mounted disk is checked: the container's own filesystem can show as fuse (rootless Podman).
if [ "$(stat -c %d "$data_at")" != "$root_device" ]; then
  case "$(stat -f -c %T "$data_at")" in
    nfs*|smb*|cifs|fuse*|v9fs)
      warn "$data_dir is on a network filesystem: SQLite's write-ahead log is not safe there. Keep the database on a local disk." ;;
  esac
fi

if [ "$(id -u)" = 0 ]; then
  as_node() { setpriv --reuid=node --regid=node --init-groups -- "$@"; }
  if ! as_node true 2>/dev/null; then
    warn "started as root without the SETUID/SETGID capabilities: run the container as uid 1000 (Kubernetes: runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000; Docker: --user node)"
    exit 1
  fi
  for dir in "$data_dir" "$media_dir"; do
    # Created as node where it can, as a disk that maps root to nobody (NFS) may refuse root.
    [ -d "$dir" ] || as_node mkdir -p "$dir" 2>/dev/null || mkdir -p "$dir"
    # Only what is not node's already, so a large disk is not walked file by file on every start.
    # A disk that refuses chown (NFS with root_squash) is left as it is and does not stop the start.
    find "$dir" ! -user node -exec chown node:node {} + || warn "could not hand all of $dir to node"
    as_node test -w "$dir" || warn "node (uid 1000) cannot write to $dir: give uid 1000 write access to that disk"
  done
  # setpriv would keep root's HOME.
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

for dir in "$data_dir" "$media_dir"; do
  at="$(existing "$dir")"
  [ -w "$at" ] || warn "uid $(id -u) cannot write to $at: mount a volume there writable by uid $(id -u) (Kubernetes: set fsGroup)"
done
exec "$@"
