# Database and media backup / restore

The custom app stores accounts, classes and progress in SQLite and uploaded audio
in a separate filesystem directory. Protect both. These tools do not connect to
the running host automatically, change production paths, or upload anything until
an operator explicitly runs the off-server command with a configured destination.

## Requirements and consistency

- Python 3.10+ with the standard `sqlite3` module. No SQLite CLI or npm package is
  required for backup/restore. The application itself still needs its npm install.
- Read access to the database, its WAL sidecars, and all media. Private writable
  space for the archive, a temporary snapshot and verification extraction.
- **Stop all application and media writers for the complete snapshot.** The
  `--application-stopped` flag is an operator acknowledgement, not a service-state
  detector. The SQLite Online Backup API captures committed WAL data safely;
  filesystem media and database rows cannot form one cross-storage transaction.
  The tool also rejects observed media changes, but that is not a substitute for
  stopping writers. Coordinate the brief downtime with the service owner.
- A database file must already exist. Missing databases are errors, never newly
  created "successful" backups. A missing media directory is also an error; use
  `--media-empty` only after confirming the installation has no uploaded media.

`DATABASE_PATH` and `MEDIA_ROOT` must be the **same values as the application**.
Defaults are `.data/bangla-adventures.db` and `.data/media`, relative to the current
working directory. `DATA_DIR` is no longer used. The utility does not load `.env`
or a systemd EnvironmentFile implicitly; pass/export the actual configured values.
It supports database and media in completely different directories.

## Create and verify a local snapshot

Run from the release directory with application writers stopped. The existing
host's reference paths are illustrated below; confirm the active service settings
before using them. Never stop unrelated services or alter a shared-server vhost.

```sh
DATABASE_PATH=/var/lib/bangla-adventures/bangla-adventures.db \
MEDIA_ROOT=/var/lib/bangla-adventures/media \
bash scripts/backup.sh /var/backups/bangla 14 --application-stopped
```

The result is JSON with the archive's absolute path, SHA-256, file count and a
verification result. Record the returned path; replace `ARCHIVE` below with it.

```sh
python3 scripts/backup_restore.py verify ARCHIVE
```

The output directory must be private (mode `0700`); new directories are created
that way. Existing directories are not silently chmodded. Archives and extracted
files are `0600`. A snapshot includes only `database.sqlite3`, `media/` and a
versioned checksum manifest, with no `.env`, host credentials or TLS keys.

The utility reads SQLite through a read-only connection, creates a self-contained
snapshot, checks database integrity, copies media, and validates the completed
archive before publishing it. Failed snapshots do not replace valid archives.
Retention deletes only this utility's exact timestamp/random-name archive format;
it does not delete unrelated files, symlinks or older differently named backups.
A private `.latest-backup.json` receipt points to the last successful snapshot;
the newly completed archive is always retained even if the host clock moves back.
A lock prevents two backup/retention runs from overlapping. If a job is killed,
inspect the process/job and `.bangla-backup.lock` before manually removing a stale
lock; never remove a lock belonging to an active backup.

Resume the app after the local snapshot succeeds or fails, then check its health.
Run remote transfer after resuming service; upload time does not require downtime.

## Restore drill into a new directory

Restore deliberately refuses every existing destination, even an empty directory.
It never overwrites the production database or media. Its parent directory must
already exist. Use a private test parent and a new child path:

```sh
bash scripts/restore.sh ARCHIVE /private/restore-drills/bangla-20261028
```

The result contains:

```text
bangla-adventures.db
media/
restore-receipt.json
```

The archive is decoded without `extractall`: links, devices, sparse files,
duplicate entries, absolute/traversal paths and unexpected top-level paths are
rejected. Every file's size/hash and SQLite integrity are checked. A failed drill
removes only the newly reserved destination. Default limits are 100,000 members,
16 MiB for the manifest and 20 GiB total uncompressed data; `--max-bytes` can raise
the latter for a known larger backup after reviewing available disk capacity.

Checksums detect corruption; they do not authenticate an archive if an attacker
can replace its manifest too. Obtain archives from protected, trusted storage.
Do not test arbitrary archives as root or in a sensitive filesystem location.

To prove application recovery, start a separate instance on a loopback test port
with `DATABASE_PATH` and `MEDIA_ROOT` pointing at this new directory. Inspect the
expected accounts, class counts, representative progress, media playback and
`/api/health`. Treat a restored production snapshot as private production data:
do not expose it publicly, run mutation fixtures against it, or commit it.
Record the backup/snapshot ID, date, tested app commit, checks, result and reviewer.

Actual disaster recovery is a separate maintenance action: stop writers, preserve
the current state, restore into a new location, arrange the app user's ownership,
verify it, then switch the service's paths. Keep the previous state for rollback.
This utility intentionally does not automate a destructive in-place restore.

## Encrypted off-server copies

Local archives are **not encrypted** and cannot survive loss of the host. Keep
the archive directory on protected storage and copy completed archives into a
separate encrypted backup repository. A supported example is
[restic](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).
The operator must choose and authorize the remote destination, initialize it once,
and securely store its repository password and backend credentials outside Git.
Store a recovery copy of the encryption password separately from the source host.

Configure a private host-only environment file, for example
`/etc/bangla-adventures/backup.env` (mode `0600`):

```dotenv
# Replace with the client's approved remote restic repository; no live value ships.
RESTIC_REPOSITORY=sftp:backup-user@backup.example.org:/srv/bangla-restic
RESTIC_PASSWORD_FILE=/etc/bangla-adventures/restic-password
BACKUP_DIR=/var/backups/bangla
BACKUP_MAX_AGE_HOURS=36
```

Install restic from its official package/release instructions and configure the
selected backend's authentication through private host configuration. Initialize
the approved repository interactively with `restic init` after loading that
environment; do not create passwords or remote credentials in source files.
Then, using those environment variables:

```sh
bash scripts/backup-offsite.sh
restic snapshots --tag bangla-adventures
```

`backup-offsite.sh` uses the successful-backup receipt to select the last complete
archive (without guessing from timestamps), rejects a missing, stale or
future-dated backup and an insecure password file, verifies the archive again, and sends
it to restic with a `bangla-adventures` tag. It does not initialize repositories,
delete remote snapshots, or copy in-progress snapshot directories.

For a dedicated operator-approved Linux host, a configurable off-server transfer
unit can be installed as `/etc/systemd/system/bangla-offsite-backup.service`:

```ini
[Unit]
Description=Copy verified Bangla archive to encrypted off-server storage
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=bangla-adventures
Group=bangla-adventures
EnvironmentFile=/etc/bangla-adventures/backup.env
WorkingDirectory=/opt/bangla-adventures/current
ExecStart=/bin/bash scripts/backup-offsite.sh
UMask=0077
```

An associated `bangla-offsite-backup.timer` example is:

```ini
[Unit]
Description=Daily Bangla off-server backup transfer

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=5m

[Install]
WantedBy=timers.target
```

These are templates, not enabled jobs. Agree the host timezone and a separate
local-snapshot maintenance workflow that finishes before transfer. The local job
must stop only the app, always resume it even after a backup error, and alert on
failure. Do not schedule `--application-stopped` without actually arranging that
maintenance window. Give the unit user access to only the required private
archives/password file. Enable and inspect the timer only after one successful
manual snapshot, remote transfer and remote restore drill. Monitor failed jobs,
last successful local/remote snapshot age, disk space and backup size.

Run `restic check --read-data` on an agreed schedule to read and check the stored
data, then periodically restore a specific recorded snapshot into a new private
staging directory using `restic restore SNAPSHOT_ID --target NEW_DIRECTORY`.
Locate its archive, run this project's `verify` and restore drill, and record the
result. Agree remote retention with the client; this project never runs remote
`forget` or `prune` automatically.

## Automated checks

```sh
python3 -m unittest discover -s tests -p 'backup_restore_test.py' -v
```

Tests use disposable SQLite fixtures and cover committed WAL data, external
database/media paths, round-trip restoration, permissions, missing sources,
retention boundaries, tampering, invalid databases, path traversal, archive links,
duplicate entries, extraction limits and refusing existing destinations.

Technical references: [SQLite Online Backup API](https://www.sqlite.org/backup.html),
[Python sqlite3 backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup),
[Python tar archive safety](https://docs.python.org/3/library/tarfile.html#extraction-filters),
[restic backup](https://restic.readthedocs.io/en/stable/040_backup.html),
[restic integrity checks](https://restic.readthedocs.io/en/stable/045_working_with_repos.html),
and [restic restore](https://restic.readthedocs.io/en/stable/050_restore.html).
