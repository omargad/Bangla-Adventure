# Private staging operations

These jobs apply only to the existing private staging project. They do not
configure public production, offsite storage or notifications to a person.

| Setting | Technical staging default |
| --- | --- |
| Operator / daemon | The `DEPLOY_USER` account, UID 1002; `unix:///run/user/1002/docker.sock` |
| Application project | `bangla-adventures-staging` |
| Data volume | `bangla-adventures-staging_bangla-data` |
| Local archive volume | `bangla-adventures-staging-backups` |
| Schedule | Daily at **03:30 UTC** |
| Local archive count | **14**, including deployment snapshots in the same archive volume |
| Monitoring | Every **5 minutes**, starting five minutes after timer activation |
| Backup-age limit | **36 hours**, with future timestamps also reported as failures |
| Free-disk threshold | **1 GiB** on the staging filesystem |
| Status storage | `/opt/bangla-adventures/private-staging/ops`, mode `0700`; JSON files `0600` |

The schedule and retention are staging defaults, not the client's production
policy. Local archives share the VPS failure domain and are not an offsite copy.

## Install and prove the user-manager jobs

The acceptance controller uploads the five `private-staging-ops*` scripts and
four files from `deploy/private-staging-ops/` into one private, owned payload.
Run as the deployment user (UID 1002):

```sh
bash PAYLOAD/private-staging-ops-install.sh PAYLOAD
```

The installer accepts only its reviewed acceptance-payload path. It validates
the actual rootless daemon, pinned application image, staging release manifest,
container mounts, private network and absence of published ports. It installs
only these **user** units, refusing unrelated files or symlinks:

- `ba-private-stage-backup.service` and `.timer`
- `ba-private-stage-monitor.service` and `.timer`

It performs a fresh backup service invocation and a fresh monitoring service
invocation before enabling the timers. Each result must have a successful
systemd exit status, a fresh completion timestamp and its actual invocation ID.
A deferred/busy result or an older successful receipt cannot pass installation.
Failure, including a stop request (code `interrupted`), restores the prior
managed files and timer states under the deployment lock; stop requests during
that restore are ignored. A stop request or a time-out during a first run ends
only the wait for it: the started run, or a deploy that deferred it, still
holds the lock, so the installer waits up to 15 minutes for the lock before
restoring, and reports the original code. If the lock is still busy then, the
new files stay, the earlier timer states are restored, and the result adds
`rollback-incomplete`; run the installation again afterwards. No root system
unit, Nginx setting or firewall rule is installed.

The units run as the deployment user, so every folder from its home directory
down to `~/.config/systemd/user` must be a real directory owned by that user that
nobody else can write to. Group write is accepted only when the group is the
user's own private group with no other members, which is Ubuntu's default (its
`002` umask makes such folders group-writable). Installation never changes these
permissions; a refusal names the folder and the reason, for example
`unsafe-unit-directory-config-writable`.

The runtime entry point is:

```sh
bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh monitor
bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh backup
bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh exercise
bash /opt/bangla-adventures/private-staging/tools/private-staging-ops.sh status
```

## Snapshot and recovery behavior

Backup, monitor, deployment and QA checks share staging's `.deploy.lock`.
Operations recheck the release and resource scope while holding that lock.
A scheduled check deferred by another transaction exits `75`; its unit records
that as a safe deferral, rather than running concurrently or pretending a new
snapshot completed.

A local backup requires healthy owned staging containers and sufficient disk
space. It stops only that project's app and transport proxy and confirms that
no running container uses the source volume. The source is mounted read-only
in a uniquely identified helper. SQLite integrity and foreign keys are checked
before the existing consistent SQLite/media snapshot tool runs. Routine
snapshots accept legitimate data in the staging volume; they do not require an
empty installation.

Helper containers have unique IDs and ownership labels. Completion, timeout,
interruption and failure paths explicitly remove the owned helper and prove it
is gone before application writers resume. The app and proxy are restarted and
required healthy even after a snapshot failure. A failed recovery is reported as
a failure requiring operator attention; it is never converted into success.

A stop request (SIGTERM, as systemd sends when it stops a unit, or SIGHUP)
interrupts the running Docker command at once and is recorded with the code
`interrupted`. Recovery then runs as above. If the request arrived while the
app and proxy were still stopping, recovery first finishes that stop, so `up`
never meets a writer that is about to exit. Recovery cannot be interrupted:
after the first stop request, and during any recovery, further stop requests
and hang-ups are ignored. The units allow four minutes for this before systemd
kills the run.

The controlled `exercise` action is intended for the clean acceptance state.
It stops the same staging writers, then intentionally attempts a backup into a
new owned **read-only disposable volume**. This must fail. It then verifies
healthy recovery, unchanged logical database state, unchanged real archive
inventory, and removal of the disposable volume. It never damages an actual
archive or permits an arbitrary failure command/path.

## Monitoring and failure reporting

The monitor checks real application health through the private Unix socket,
both Docker health states, actual port isolation, free disk, the latest verified
archive, backup age and the last backup job's result. Each run writes a bounded
JSON status and produces the same aggregate result in the user journal. Failure
codes include `health-unavailable`, `container-unhealthy`, `disk-low`,
`backup-unverified`, `backup-stale-or-future` and `backup-job-failed`. A run
stopped part-way records `interrupted`; any other unexpected error records
`operation-failed` (or `install-failed` for the installer). Raw database
rows, passwords, session values, registry tokens and environment contents are
excluded.

Inspect as the deployment user:

```sh
systemctl --user list-timers 'ba-private-stage-*'
systemctl --user status ba-private-stage-backup.service ba-private-stage-monitor.service
journalctl --user -u ba-private-stage-backup.service -u ba-private-stage-monitor.service
```

The acceptance evidence distinguishes actual successful user-manager invocations
and the actual backup-destination failure/recovery exercise from synthetic
checker fixtures for unhealthy services, low disk, stale/future backups and
failure reporting. Passing local tests alone does not establish an installed
timer; use the final live installation and exercise results.

The client must still supply production backup location, retention, credentials,
key custodian and operational/alert owner before production offsite jobs or
external notifications are activated ([BACKUP_DESTINATIONS.md](BACKUP_DESTINATIONS.md)).
Existing offsite scripts and restoration instructions are documented in
[BACKUP_RESTORE.md](BACKUP_RESTORE.md).

The **VPS off-site rehearsal** workflow reads the newest staging archive, under
the staging lock, to rehearse the production off-site copy with a throwaway
local restic repository, and reads these timers' status without changing them
([Off-site rehearsal](PRODUCTION_OPERATIONS.md#off-site-rehearsal)).
