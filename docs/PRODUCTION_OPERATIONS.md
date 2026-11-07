# Production operations

Scheduled backups, monitoring, encrypted off-site copies and a daily status alert
for the production site on the client's VPS. Nothing here runs until it is
installed at go-live ([Going live](VPS_DEPLOYMENT.md#going-live), step 9). The
jobs are **user** systemd units of the deployment user (UID `1002`, the
`DEPLOY_USER` account) and use its rootless Docker daemon at
`unix:///run/user/1002/docker.sock`. No root, system unit, Nginx or firewall
change is involved.

## What runs when

| Job | When | What it does |
| --- | --- | --- |
| Backup | Daily, **16:30 UTC** | Stops the app for a few seconds, takes the deploy's own backup, starts the app again |
| Monitor | Every **5 minutes** | Checks health, exposure, disk, backup age, the public site and its certificate, off-site age |
| Off-site copy | Daily, **17:15 UTC**, once configured | Sends the newest verified archive to the client's encrypted restic repository |
| Status alert | Daily, **19:41 UTC**, on GitHub | Reads the results above and fails (so GitHub emails the owner) when anything is failing or stale |

16:30 UTC is 03:30 in Melbourne during daylight saving (02:30 the rest of the
year) and 22:30 in Dhaka: the quietest time for the site's families and
teachers, and outside the Melbourne working day when deploys are pushed. The
schedule is in UTC, so it never moves with daylight saving on the server. The
off-site copy follows 45 minutes later, once the night's archive exists. To
change either time, edit `OnCalendar=` in
`deploy/production-ops/ba-production-backup.timer` (and keep the off-site timer
at least 45 minutes later), merge it, and run the workflow's `install` action
again. Do not edit the installed units on the server: the jobs check them
against their installation record and report `installation-invalid`.

### Downtime

The backup stops only the app container: the site answers `502` from Nginx
until the app is serving again. In the local end-to-end check that took
**3.4 seconds** from stopping the app to its first healthy answer. It grows with
the amount of uploaded media: with 300 MB of media it was about 16 seconds. Each run records its own figure as
`measures.downtimeSeconds` in `last-backup.json`. The whole run, including
waiting for Docker to report the restarted container healthy, took 8 seconds.

## Where things are

| Item | Location |
| --- | --- |
| Tools | `/opt/bangla-adventures/ops/tools/` (`production-ops.sh`, `production-ops.py`) |
| Results | `/opt/bangla-adventures/ops/last-backup.json`, `last-monitor.json`, `last-offsite.json` |
| Installation record | `/opt/bangla-adventures/ops/installation.json` (tool and unit hashes) |
| Units | `~/.config/systemd/user/ba-production-{backup,monitor,offsite}.{service,timer}` |
| Archives | `/opt/bangla-adventures/backups/`, shared with the deploy's backups; 14 kept in all |
| Off-site settings | `~/.config/bangla-adventures/offsite.env` and `restic-password` (see below) |
| Logs | The user journal: `journalctl --user -u 'ba-production-*'` |

`ops/` and `ops/tools/` are mode `0700` and owned by UID `1002`; result files
are `0600`. Nothing is written inside `backups/`. That folder belongs to the
app's container user (uid 1000), which on the rootless host is a subordinate
UID: the deployment user cannot read archives directly, so everything that
reads them runs in a short-lived container as uid 1000 with `backups/` mounted
read-only and no network.

## Switching it on

Before installing:

- The first deploy has succeeded, and `PUBLIC_ORIGIN` names the live HTTPS
  address. The monitor checks that address and its certificate, so install
  after Nginx and the certificate work.
- The deployment user lingers, so its timers run while nobody is logged in
  (rootless Docker needs this too): `ls /var/lib/systemd/linger/` lists the
  account. If not, an administrator runs `sudo loginctl enable-linger ACCOUNT`.
  The installer refuses with `user-linger-disabled` otherwise.
- The status key is ready ([Setting up the status key](#setting-up-the-status-key),
  steps 1 to 3), so that the same run installs it.

Then, in GitHub, open **Actions > VPS production operations > Run workflow** on
`main`, choose `install` and tick the confirmation. The workflow runs only when
the repository variable `DEPLOY_ENABLED` is `true` and uses the `production`
environment, so a configured reviewer approves it. It connects exactly as the
deploy does: the `DEPLOY_HOST` and `DEPLOY_USER` secrets, the `DEPLOY_SSH_KEY`
secret checked against the pinned key fingerprint, and `DEPLOY_KNOWN_HOSTS`
checked line by line against the pinned host-key fingerprint. It never prints
the address or account.

Before the approval prompt, the run's credential-free `validate` job prints the
change `install` would make to the status key: `status key: SHA256:...
requested.`, `status key: removal requested.` or `status key: not requested`.
Anyone with write access can change the `STATUS_SSH_PUBLIC_KEY` variable, so
the reviewer opens that job (**Show the status key change for the reviewer**)
and approves only if it shows the expected change; for a new key, the
fingerprint noted when its pair was made
([Setting up the status key](#setting-up-the-status-key), step 2). After the
approval, `install` refuses, before connecting, if the variable now asks for
anything else: "STATUS_SSH_PUBLIC_KEY now asks for something other than what was
shown before the approval". That also happens when the variable is set on the
`production` environment, which `validate` cannot see; keep it a repository
variable only.

The installation:

1. uploads the four tools, the six units and a small request naming the public
   halves of the deploy key and of `STATUS_SSH_PUBLIC_KEY` (never a private key)
   into a new private folder, `/opt/bangla-adventures/ops/.incoming.*`;
2. checks the rootless daemon, the server `.env`, a healthy app and safe unit
   folders (the same rules as private staging: every folder from the home
   directory down to `~/.config/systemd/user` must belong to the deployment user
   and be writable by nobody else, except its own private group under Ubuntu's
   `002` umask; a refusal names the folder, for example
   `unsafe-unit-directory-config-writable`);
3. under the deploy lock, checks `~/.ssh/authorized_keys` when
   `STATUS_SSH_PUBLIC_KEY` is set (see
   [What the install changes in authorized_keys](#what-the-install-changes-in-authorized_keys)),
   stops the timers, replaces the tools and units atomically, writes the
   installation record, adds or replaces the status key's line, and reloads the
   user manager;
4. runs one backup, then one off-site copy if it is configured, then one
   monitor, each through systemd, and requires each to exit `0` with a fresh
   result carrying its own systemd invocation ID; an older result or a deferral
   does not count;
5. only then enables the three timers.

A successful run ends with `status key: installed`, `replaced`,
`already-present`, `removed`, `already-absent` or `unchanged` (the variable is
unset, so `authorized_keys` was not read or changed).

Any failure fails the run with fixed codes, a `rollback` state and a
`status key` state, and the workflow's message follows them:

| `rollback` | Meaning |
| --- | --- |
| `none` | The installer stopped before changing anything |
| `complete` | The previous files, record and timer states are back. A status-key line this run added where there was none is taken out again (`status key: unchanged`); a removal or a replacement stays (`status key: removed` or `replaced`), so a revoked key never works again |
| `incomplete` | A deploy still held the lock after 20 minutes: the new files (and any new status-key line, `status key: installed`) stayed, and the earlier timer states were restored (code `rollback-incomplete`); run `install` again after the deploy |
| `failed` | The rollback itself failed (code `rollback-failed`); check the timers on the server |

A rollback only ever narrows access, because revoking a key is never riskier
than keeping it: after a leak, a failed install still leaves the old status
key revoked, and the message says so, for example "The status key removal
stayed: the earlier status key no longer works."

A rollback after the initial runs waits up to 20 minutes for the deploy lock,
because a deploy that starts during those runs, and so defers one of them
(`initial-backup-deferred`), holds it. Once a rollback has started, a dropped
connection or cancelled run no longer interrupts it. Run `install` again
whenever these tools or units change.
The same workflow also offers `status`, and `backup-now`, which starts the
installed backup service and waits for its result (the service carries on if
the connection drops, and the run then says so: see
[When the daily check fails](#when-the-daily-check-fails)). Only `install`
uses `STATUS_SSH_PUBLIC_KEY`.

Finally, run the [status alert](#alerting) once by hand.

## The backup

Each run:

1. takes the deploy lock (`.deploy.lock`) without waiting. If a deploy or
   another backup holds it, the run exits `75` ("deferred"), which the unit
   treats as success, and nothing is stopped or recorded;
2. stops with `backup-helper-running`, changing nothing, if a container that
   can write to `backups/` is still running: its backup lock may be in use, and
   the next step would make its writes fail;
3. prepares `backups/` as the deploy does (uid 1000, mode `0700`; for a moment
   the folder belongs to the container's root user, so uid 1000 cannot write);
4. removes a backup lock that an earlier run left behind, while the app still
   serves (`stale-backup-lock-cleared-at-start`; see
   [A stale backup lock](#a-stale-backup-lock));
5. requires the app container to be running and healthy, with the configured
   image, and `http://127.0.0.1:APP_PORT/api/health` answering `200`. It waits up
   to two minutes, for example when a missed run starts just after a reboot;
6. requires at least 1 GiB free on the deployment filesystem;
7. stops only the app, and confirms no container is running on the data volume;
8. runs the deploy's own backup command with the current `APP_IMAGE`:
   `docker compose run --rm --no-deps --volume /opt/bangla-adventures/backups:/backups app bash scripts/backup.sh /backups 14 --application-stopped`
   (14 archives kept, including the deploy's own), plus two labels that let the
   job find and remove its helper container if the run is interrupted;
9. **always** starts the same app container again, also after a failed or
   interrupted backup or a stop request, and waits up to three minutes for
   `/api/health` on the loopback port, then for Docker's own health check to
   report it healthy, so the next monitor run never sees a container that is
   still `starting`;
10. if the backup helper had to be killed (a timeout or a stop request), removes
    the lock and staging copy it left in `backups/`, once the app is serving
    again and still under the deploy lock;
11. confirms the new `.latest-backup.json` receipt names the archive just made.

A stop request (`systemctl --user stop`, a shutdown, or the unit's own time
limit) interrupts the running Docker command at once; the job then recovers as
above before it exits. Later stop requests wait for that recovery. The unit
allows six minutes for it before systemd kills the job.

A stop request that arrives while the app is being stopped cuts the stop
command short, but Docker carries on: the app has already been asked to stop
and exits within its 30-second `stop_grace_period`. Starting it before then
would do nothing (it is still running), and once it exits Docker treats it as
stopped by hand, so `restart: unless-stopped` would leave the site down. The job
therefore waits up to a minute for the app to exit and only then starts it. If
it is still running after that, the stop never reached Docker (which would have
killed it), and the app is left running. A stop request that arrives before the
app is stopped never stops it.

A failed backup or a failed restart exits non-zero and records its codes, for
example `backup-failed` or `resume-failed` (both appear when both happen). A
passing run that cleared an old lock first keeps `stale-backup-lock-cleared-at-start`
in its codes; status still counts it as passed. A deploy
started at the same moment is refused with "another deployment is running";
run it again a minute later.

## The monitor

The monitor never takes the deploy lock, so it can never make a deploy fail. It
reads the kernel's lock table (`/proc/locks`) for a lock on `.deploy.lock`:
when a deploy or backup is running, or starts during the checks, the run is
deferred (exit `75`) instead of reporting a stopped app. If that table cannot be
read the run fails with `lock-state-unreadable`. The table names the file by
device and inode, and only the inode is compared: on btrfs subvolumes and some
overlay set-ups the kernel's device number differs from the one `stat` gives,
which would hide every deploy. Another file with the same inode number on a
different disk, locked at that moment, could only make a run defer, which is the
safe direction; a lasting one would show as `monitor-report-stale`.

| Check | Failure code |
| --- | --- |
| `http://127.0.0.1:APP_PORT/api/health` answers `200` | `health-unavailable` |
| The app container is running, and Docker reports it healthy | `app-not-running`, `app-unhealthy` |
| It runs the image named by `APP_IMAGE` in `.env` | `app-image-mismatch` |
| Nothing in the project publishes a port except the app on `127.0.0.1:APP_PORT` | `port-exposed` |
| At least 1 GiB free on the deployment filesystem (the staging threshold) | `disk-low` |
| The newest successful-backup receipt names an existing archive | `backup-missing` |
| That archive is at most 36 hours old and not more than 5 minutes in the future | `backup-stale-or-future` |
| The last scheduled backup run passed | `backup-job-failed` |
| No backup lock is left in `backups/` while the deploy lock is free ([A stale backup lock](#a-stale-backup-lock)) | `stale-backup-lock-found` |
| `https://PUBLIC_ORIGIN/api/health` answers `200` | `public-health-failed` |
| Its certificate verifies and expires in at least 14 days | `certificate-expiring-or-invalid` |
| With off-site configured: the last successful copy is at most 48 hours old | `offsite-stale` |

The certificate check catches a failed Let's Encrypt renewal: certbot renews
about 30 days before expiry, so 14 days left means renewal has been failing for
over two weeks. The receipt is read in a container as uid 1000; the monitor does
not unpack the archive every five minutes, since the backup verified it when it
was made and the off-site job verifies it again daily. The same read-only
container notes whether `backups/.bangla-backup.lock` exists, so the lock check
adds no container and no time.

## Off-site copies

Local archives share the server's fate and are not encrypted. The off-site job
copies the newest verified archive into a [restic](https://restic.net)
repository chosen by the client, encrypted before it leaves the server. It is
**inert until configured**: the unit only starts when
`~/.config/bangla-adventures/offsite.env` exists.

[Choosing the off-site backup destination](BACKUP_DESTINATIONS.md) is the guide for the
client: the options and their cost, the recommendation (Backblaze B2 through its S3
endpoint), how to make a key limited to one bucket, what to send and how, the key
custodian and the retention decision. Until the client answers, the
[Off-site rehearsal](#off-site-rehearsal) proves the same restic container on the server
with a throwaway local repository.

Because the archives are readable only from a container, restic runs in the
official image, pinned by digest:

```text
restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510
```

(restic 0.19.1, built 5 July 2026; the digest is the multi-platform image index.)
The container runs as uid 1000 with a read-only root filesystem, temporary
in-memory `/tmp` and cache, no capabilities, `backups/` mounted read-only and
the password file mounted read-only. Credentials reach it only through
`--env-file` from `offsite.env`; nothing secret is on a command line, and the job
never prints a credential or the repository location.

Each run verifies the archive named by the `.latest-backup.json` receipt (its
SHA-256 and the app image's `python3 scripts/backup_restore.py verify`), refuses
one older than 36 hours or dated in the future, sends only that file with the tag
`bangla-adventures` and the fixed host name `bangla-adventures-production`, and
confirms the new snapshot lists it.

### Supported destinations

Only backends configured purely by environment variables work in this
container mode:

| Repository | Settings in `offsite.env` |
| --- | --- |
| `s3:` (Amazon S3 or compatible, HTTPS only) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_DEFAULT_REGION`, `AWS_SESSION_TOKEN` |
| `b2:` (Backblaze B2, native) | `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`; restic's documentation recommends B2's S3 endpoint through `s3:` instead |
| `rest:https://` (restic REST server) | Optional `RESTIC_REST_USERNAME`, `RESTIC_REST_PASSWORD` |
| `azure:` | `AZURE_ACCOUNT_NAME` with `AZURE_ACCOUNT_KEY` or `AZURE_ACCOUNT_SAS`, optional `AZURE_ENDPOINT_SUFFIX` |
| `gs:` (Google Cloud Storage) | `GOOGLE_PROJECT_ID`, plus a service-account key in `gcs-key.json` beside `offsite.env` |

`sftp:` is **not supported** in this container mode (it needs SSH keys and host
keys inside the container), nor are local paths, `rclone:` or plain-HTTP
repositories. Any other name in `offsite.env`, including `RESTIC_PASSWORD`,
`RESTIC_PASSWORD_FILE` and `RESTIC_PASSWORD_COMMAND`, is refused
(`offsite-settings-invalid`).

### Configure it

As the deployment user, once the client has chosen the destination and its
credentials:

```sh
install -d -m 0700 ~/.config/bangla-adventures
cd ~/.config/bangla-adventures
# The repository password: keep a copy with the client, away from this server.
(umask 027; head -c 32 /dev/urandom | base64 > restic-password)
chmod 0640 restic-password
(umask 077; nano offsite.env)
```

`offsite.env` holds one `NAME=value` per line, without quotes (Docker passes
values exactly as written), for example for Backblaze B2 through its S3 endpoint
(the bucket page shows the endpoint; the key is the bucket-limited application key from
[Setting up Backblaze B2](BACKUP_DESTINATIONS.md#setting-up-backblaze-b2)):

```dotenv
RESTIC_REPOSITORY=s3:https://s3.CLIENT-REGION.backblazeb2.com/CLIENT-BUCKET/bangla-adventures
AWS_ACCESS_KEY_ID=CLIENT-KEY-ID
AWS_SECRET_ACCESS_KEY=CLIENT-APPLICATION-KEY
# Optional retention; see below.
RESTIC_KEEP_DAILY=14
RESTIC_KEEP_WEEKLY=8
RESTIC_KEEP_MONTHLY=6
```

On B2's S3 endpoint a deletion only hides a file, so the bucket's lifecycle rule must be
**Keep only the last version of the file**, or `prune` frees no space.

The files must belong to the deployment user, in a folder nobody else can
change. `offsite.env` must be `0600`, because only the Docker command line reads
it. `restic-password` (and `gcs-key.json`) must be `0640` and belong to the
account's own private group: the job runs restic as uid 1000 with that group
added (rootless Docker shows it as group 0 inside the container), which is how it
reads the file. Anything else is refused as `offsite-file-insecure` (or
`offsite-file-missing`).

Initialise the repository once with the same pinned image. Under rootless
Docker the container's root user is the deployment account itself, so these
manual commands need no uid settings:

```sh
restic_options=(--rm --env-file "$HOME/.config/bangla-adventures/offsite.env"
  --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password
  --mount "type=bind,source=$HOME/.config/bangla-adventures/restic-password,target=/run/secrets/restic-password,readonly"
  --entrypoint /usr/bin/restic)
# A gs: repository also needs its service-account key, mounted as the job does.
if grep -q '^[[:space:]]*RESTIC_REPOSITORY=gs:' "$HOME/.config/bangla-adventures/offsite.env"; then
  restic_options+=(--mount "type=bind,source=$HOME/.config/bangla-adventures/gcs-key.json,target=/run/secrets/gcs-key.json,readonly"
    --env GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs-key.json)
fi
restic_image=restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510
docker --host unix:///run/user/1002/docker.sock run "${restic_options[@]}" "$restic_image" init
```

The key is mounted only for a `gs:` repository, as the job does: `gcs-key.json`
exists only for Google Cloud Storage, and Docker refuses to mount a file that
is not there. Paste the whole block for every destination.

Then make the first copy and check it:

```sh
systemctl --user start ba-production-offsite.service
bash /opt/bangla-adventures/ops/tools/production-ops.sh status
```

The job does not initialise a repository itself (`offsite-repository-missing`
until `init` has run). From then on the monitor also requires a successful copy
within 48 hours.

### Retention (awaiting the client's agreement)

Retention is **opt-in**. Without it, every copy is kept and nothing is ever
deleted from the repository. Only when `RESTIC_KEEP_DAILY`, `RESTIC_KEEP_WEEKLY`
and `RESTIC_KEEP_MONTHLY` are all set to positive whole numbers does the job run,
after a successful copy:

```text
restic forget --tag bangla-adventures --host bangla-adventures-production --group-by host,tags \
  --keep-daily D --keep-weekly W --keep-monthly M --prune
```

Each copy has a different file name, so restic's default grouping by path would
keep every copy; grouping by the fixed host and tag applies the policy to all of
them. The copy is recorded as a success before retention starts, so a retention
run that fails, times out (`offsite-retention-timeout`) or is stopped keeps the
copy's `lastSuccessEpoch`. The whole run, retention included, stays within
3 hours 45 minutes, inside the unit's 4-hour limit. Until there are more copies
than the policy keeps, restic also keeps the oldest copy ("oldest daily
snapshot"), so the first copy stays for a while.
Setting only some of the three, or a zero, is refused
(`offsite-retention-invalid`) before anything is sent.

The **proposed policy is 14 daily, 8 weekly and 6 monthly copies**, about six
months of history. It is a suggestion awaiting the client's agreement, together
with the destination, its cost and who holds the password
([The retention decision](BACKUP_DESTINATIONS.md#the-retention-decision)).

## Off-site rehearsal

Before the client has chosen a destination, and before production exists, the
**VPS off-site rehearsal** workflow proves on the real server everything the off-site job
does, except the upload to the client's storage. It needs no client credential and sends
nothing off the server.

To run it, open **Actions > VPS off-site rehearsal > Run workflow** on `main`, tick
**confirm_offsite_rehearsal** and start it; a configured reviewer of the `production`
environment approves it, as for the other server workflows. It takes about a minute plus the time to read
the archive a few times. It runs only in the production repository, on `main`, while the
repository variable `DEPLOY_ENABLED` is unset or `false` (the private staging gates), and
it shares the private staging concurrency group, so it never overlaps a staging start or
an acceptance run. Without the tick, the controller refuses before loading any key or
connecting. It connects as private staging does: the `DEPLOY_HOST` and `DEPLOY_USER`
secrets, the deploy key and the server host key checked against their pins first, and
neither the address nor the account is ever printed. Avoid 03:30 UTC, when the staging
backup runs.

On the server, as the deployment user (UID `1002`) and from a private upload folder that
is removed afterwards (`scripts/private-staging-offsite-rehearsal.sh` uploads
`private-staging-offsite-rehearsal.py` with the staging and production operations tools,
which it uses unchanged as libraries), it:

1. checks the private staging scope exactly as the staging jobs do (account, private
   folder, marker, release manifest, pinned image, rootless daemon, data volume), then
   takes the staging deploy lock, waiting up to 10 minutes for a staging backup, deploy or
   check, and checks the scope again; it holds the lock until its clean-up has finished,
   so no staging backup can rotate the archive away while it is read;
2. reads the newest staging archive named by `.latest-backup.json` in the staging archive
   volume, checks its SHA-256 against that receipt and runs the project's own
   `backup_restore.py verify` on it (manifest, file checksums and SQLite integrity);
3. creates a new private folder,
   `/opt/bangla-adventures/private-staging/.offsite-rehearsal-RANDOM` (mode `0700`), with
   a random repository password made there (`0640`, read by the container through the
   deployment user's own group, as in production) that is never printed;
4. pulls the pinned restic image if it is not already present (the only network use),
   then runs the production job's restic container, with `--network none`, against the
   throwaway `local:/repository`: `init`; `backup` of `/backups/NAME` with the production
   host name and tag, confirmed by `snapshots`; `check --read-data`;
5. previews the proposed retention with
   `forget --dry-run --group-by host,tags --keep-daily 14 --keep-weekly 8 --keep-monthly 6`
   (it never runs `--prune` or deletes anything);
6. restores the snapshot to a temporary folder with `restore --verify`, and proves the
   restored file's SHA-256 equals the original's and that it passes the same archive
   verification;
7. removes the repository, the password and the restored files, and every helper
   container, on every path (success, failure, a stop request or a dropped connection),
   then shows that none of them remains; a folder left by a run that was killed outright
   is removed by the next run before it starts;
8. reads, without changing anything, the staging backup and monitor timers (enabled,
   active, last triggered), their last results with codes and last success times, and
   whether the staging operations installation still matches its record.

It never changes the staging app, its data, its archives or timers, production, Nginx or
the firewall. The containers run with no capabilities except, for the final clean-up only,
`DAC_OVERRIDE` inside the user's own rootless namespace, so that files the restic user
wrote can be removed.

The run ends with fixed lines and a JSON result, also kept as the run's
`offsite-rehearsal` artifact for 30 days and shown in the run summary:

```text
off-site rehearsal: passed; codes: none
  newest staging archive: 42.0 MB, created 0.3 h ago, 5 files; SHA-256 and archive verification passed
  restic 0.19.1 (pinned image, no network): image passed, init passed, backup passed, check --read-data passed
  retention preview (forget --dry-run, keep 14 daily, 8 weekly, 6 monthly): passed; 1 kept, 0 would be removed
  restore to a temporary folder: passed; SHA-256 equals the original: yes; archive verification (SQLite integrity): passed
  clean-up: passed; throwaway repository, password and restored files removed and shown to be gone; left by earlier runs and removed: 0
  private staging backup timer: enabled, active, last triggered 7.4 h ago; last run passed 7.4 h ago, last success 7.4 h ago; codes: none
  private staging monitor timer: enabled, active, last triggered 0.0 h ago; last run healthy 0.0 h ago, last success 0.0 h ago; codes: none
  private staging operations installation: valid
```

A staging timer that is failing does not fail the rehearsal; it is reported so that it
can be fixed (run **VPS private acceptance** to reinstall the staging jobs). The
rehearsal's own codes are:

| Code | Meaning |
| --- | --- |
| `transaction-busy` | A staging backup, deploy or check held the staging lock for 10 minutes; the run deferred (run it again later) |
| `payload-path` | The script was not started from the workflow's upload folder |
| `archive-unreadable`, `archive-unverified` | The newest staging archive could not be read, or its SHA-256 or verification failed |
| `disk-low` | Less than 1 GiB free, or less than three times the archive plus 1 GiB, before the repository was made |
| `workspace-exists` | The new folder's random name was already taken |
| `restic-image-unavailable` | The pinned restic image could not be pulled or does not carry the pinned digest |
| `rehearsal-init-failed`, `rehearsal-backup-failed`, `rehearsal-check-failed` | That restic step failed |
| `rehearsal-repository-missing`, `rehearsal-repository-locked`, `rehearsal-password-wrong` | restic exit codes 10, 11 and 12 |
| `rehearsal-snapshot-unverified` | The new snapshot did not list exactly the archive |
| `rehearsal-retention-preview-failed` | The dry-run `forget` failed or did not keep the new snapshot |
| `rehearsal-restore-failed`, `restored-archive-unreadable` | The restore failed, or the restored file could not be read |
| `rehearsal-restore-mismatch`, `rehearsal-restore-unverified` | The restored file differs from the original, or fails the archive verification |
| `cleanup-failed`, `helper-cleanup-failed`, `helper-id`, `helper-identity` | Something of the rehearsal could not be shown to be removed: `ls -a /opt/bangla-adventures/private-staging` and `docker ps --all --filter label=io.bangla.scope=private-staging-offsite-rehearsal` (the next run removes a left folder first) |
| `earlier-workspace-cleanup-failed` | A folder left by an earlier killed run could not be removed |
| `interrupted` | A stop request or a dropped connection ended the run; the clean-up still ran |
| `command-failed`, `command-unavailable-or-timeout`, `operation-failed` | A Docker command failed or ran past its time limit, or an unexpected error; the clean-up still ran |

The staging scope codes (`wrong-user`, `stage-marker`, `release-scope`, `image-pin`,
`non-rootless-daemon` and the others) are those of
[Private staging operations](PRIVATE_STAGING_OPERATIONS.md).

Proved locally on 7 November 2026 against a Docker daemon on a stand-in server (a UID
1002 account, the staging folder and volumes laid out as on the VPS, and a real archive
made by the staging backup command, 42 MB): a full run passed in 10 to 14 seconds; stop
requests at 1, 3, 4, 5, 6, 7, 8 and 9 seconds, which fall in every step, each ended with
`interrupted` and nothing left behind; a receipt whose SHA-256 did not match failed with
`archive-unverified` and nothing left behind; after a `SIGKILL` left the folder, the next
run removed it (`left by earlier runs and removed: 1`) and passed. That daemon was not
rootless, so the local run is not a substitute for the run on the VPS.

## Reading status

The daily alert prints a summary in its run log. On the server, as the
deployment user:

```sh
bash /opt/bangla-adventures/ops/tools/production-ops.sh status | python3 -m json.tool
systemctl --user list-timers 'ba-production-*'
journalctl --user -u ba-production-backup -u ba-production-monitor -u ba-production-offsite --since yesterday
```

`status` exits non-zero when anything is failing or stale. Its fixed fields are
`status` (`healthy` or `failed`), `codes`, `installed`, one part each for
`backup`, `monitor` and `offsite` (each with `status`, `checkedAtEpoch`,
`ageSeconds` and that job's own `codes`), `timers`, `servicesFailed` and
`lingering`. Its codes:

| Code | Meaning |
| --- | --- |
| `backup-report-missing`, `-failed`, `-stale` | No backup result, the last backup failed, or none passed for 48 hours |
| `monitor-report-missing`, `-failed`, `-stale` | No monitor result, the last check failed, or none ran for 20 minutes |
| `offsite-report-missing`, `-failed`, `-stale` | With off-site configured: no copy yet, the last copy failed, or none for 48 hours |
| `timer-inactive-backup`, `-monitor`, `-offsite` | A timer is not enabled and active |
| `service-failed-backup`, `-monitor`, `-offsite` | systemd lists the job's last run as failed, including a run it killed, which records no result of its own. A later good run clears it; so does `systemctl --user reset-failed` |
| `user-linger-disabled` | The timers stop when the deployment user logs out |
| `installation-invalid` | Installed tools or units differ from the installation record |

An off-site part of `not-configured` is not a failure. A failed off-site run
keeps its previous `lastSuccessEpoch`.

## Alerting

`.github/workflows/vps-production-status.yml` runs daily at 19:41 UTC (and on
demand), only when `DEPLOY_ENABLED` is `true`. It checks the host key against
the same pin as the deploy, runs `status` and fails when status fails; GitHub
then emails the owner of the schedule (the person who last changed its `cron`
line). It changes nothing on the server.

It runs in its own GitHub environment, `production-status`, with no required
reviewers, so the daily check never waits for a deploy approval. For that
reason it never receives the deploy key, which can do anything the deployment
user can. It uses a **status key** instead, which the server allows to run only
`status`. The reviewer-approved `install` puts that key on the server: nobody
edits files there by hand.

### Setting up the status key

Do this once, before go-live step 7 sets `DEPLOY_ENABLED=true`. The commands
work the same in PowerShell on Windows and in a macOS or Linux terminal.

1. **Create the environment.** In GitHub, open **Settings > Environments >
   New environment** and name it `production-status`. Leave **Required
   reviewers** off. Under **Deployment branches and tags** choose **Selected
   branches and tags** and add only `main`. If a scheduled run has already
   created the environment, it has no rules yet: add them before anything else.

   A workflow in an environment sees only that environment's settings and the
   repository's. If `DEPLOY_HOST` and `DEPLOY_USER` are secrets of the
   `production` environment, add both to `production-status` too, with the same
   values (**Environment secrets > Add environment secret**); if
   `DEPLOY_KNOWN_HOSTS` is a `production` environment variable, add it as well
   (**Environment variables > Add environment variable**). Moving the three to
   repository level instead also works. Never add `DEPLOY_SSH_KEY` to this
   environment. Copy the values exactly: GitHub never shows a secret again, and
   a `DEPLOY_USER` that names another account makes the server refuse the
   status key ([When the daily check fails](#when-the-daily-check-fails)).

   Use the hashed form of the `DEPLOY_KNOWN_HOSTS` line (`ssh-keyscan -H`, as
   in [DEPLOYMENT.md](DEPLOYMENT.md), step 5), so the line itself does not
   contain the address. Every VPS workflow passes `DEPLOY_KNOWN_HOSTS` only when
   the `DEPLOY_HOST` secret is present, because GitHub prints a step's variable
   values in the public run log and masks the address inside them only through
   that secret. With a missing or misnamed secret the line therefore stays out
   of the log, and the run stops with "the secret DEPLOY_HOST is missing".
2. **Make the key pair** on your own computer, not the server, in a folder of
   your choice (Windows 10 and 11 include `ssh-keygen`):

   ```sh
   ssh-keygen -t ed25519 -C bangla-adventures-status -f status_key
   ```

   When it asks for a passphrase, press Enter twice, so the key has none (the
   workflow cannot type one). This writes `status_key` (private) and
   `status_key.pub` (public). Do not add `-N ''`: Windows PowerShell drops the
   empty quotes, so the key ends up with a passphrase or the command fails.

   Note the key's fingerprint, which is not secret: `ssh-keygen -l -f
   status_key.pub` prints `256 SHA256:... bangla-adventures-status (ED25519)`.
   The reviewer compares it with the install run before approving (step 4).
3. **Save the two halves in GitHub, then delete them locally.**
   - Show the public half with `Get-Content status_key.pub` (PowerShell) or
     `cat status_key.pub`, and copy its single line,
     `ssh-ed25519 AAAA... bangla-adventures-status`, into a new **repository
     variable** `STATUS_SSH_PUBLIC_KEY` (**Settings > Secrets and variables >
     Actions > Variables > New repository variable**). It is public, and at
     repository level both the install (in `production`) and the daily check
     (in `production-status`) can read it.
   - Show the private half with `Get-Content status_key` or `cat status_key`,
     and copy all of it, from `-----BEGIN OPENSSH PRIVATE KEY-----` to
     `-----END OPENSSH PRIVATE KEY-----`, into the `production-status`
     **environment secret** `STATUS_SSH_KEY` (**Settings > Environments >
     production-status > Add environment secret**), not into the repository
     secrets.
   - Delete both files: `Remove-Item status_key, status_key.pub` (PowerShell)
     or `rm status_key status_key.pub`. GitHub keeps the only copy of the
     private key; if it is ever needed again, make a new pair instead.
4. **Install it.** Run **Actions > VPS production operations > Run workflow**
   on `main` with `install` and the confirmation ticked. Before approving the
   `production` environment, the reviewer opens the run's `validate` job and
   checks that it printed `status key: SHA256:... requested.` with the
   fingerprint from step 2. Besides the timers, the run adds the status
   key's line to the deployment user's `~/.ssh/authorized_keys` and reports
   `status key: installed` (`already-present` when a later install finds the
   same key).
5. **Check it.** Run **Actions > VPS production status > Run workflow** on
   `main` once by hand. It must end with `status: healthy`.

### What the install changes in authorized_keys

With `STATUS_SSH_PUBLIC_KEY` set, the install keeps exactly one line for the
status key in `~/.ssh/authorized_keys`, added at the end:

```text
restrict,command="bash /opt/bangla-adventures/ops/tools/production-ops.sh status" ssh-ed25519 AAAA... bangla-adventures-status
```

`command="..."` is a forced command: whatever a connection with this key asks
to run, the server runs only that status command, which reads the job results
and changes nothing. `restrict` turns off everything else a key could do: no
terminal, no port, agent or X11 forwarding, and no `~/.ssh/rc`. Should the
status key leak, it shows only the fixed status fields. The line always ends in
the comment `bangla-adventures-status`, whatever comment the key had: that
comment and the fixed start are how the installer recognises its own line.

The installer works under the deploy lock and inside the installation's
rollback, and changes nothing else:

- It refuses unless `~/.ssh` is a real folder and `authorized_keys` a real file
  (not a link), both owned by the deployment user and writable by nobody else
  (`unsafe-ssh-directory`, `unsafe-authorized-keys`). That is sshd's
  `StrictModes` rule, without the exception Ubuntu's sshd makes for the
  account's own private group. If it refuses, the server administrator runs
  `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/authorized_keys` for the deployment
  user; `install` can then run again.
- It requires the deploy key, the one this run connected with, on a line of its
  own (`authorized-keys-not-in-use` otherwise, also when the file is missing).
  That proves sshd reads this file, and the deploy key's line is never changed.
- It refuses a status key that is the deploy key (`status-key-is-deploy-key`)
  or already appears on any other line (`status-key-already-authorized`), so it
  never restricts or duplicates a key someone else added.
- It replaces an earlier status-key line (`replaced`), keeps every other line
  exactly as it was and in the same order (Windows line endings and a missing
  final line break included), writes the file atomically with mode `0600`, then
  reads it back. If anything differs it restores the previous contents
  (`authorized-keys-verify-failed`). A failed install's rollback only takes
  out a line that the run added where there was none, unless someone changed
  the file meanwhile (`authorized-keys-changed`); it keeps a removal or a
  replacement, so it never authorizes a key again.
- It never touches `authorized_keys2`, the sshd settings or anything outside
  the deployment user's `~/.ssh/authorized_keys`.

With `STATUS_SSH_PUBLIC_KEY` unset, the install does not read or change
`authorized_keys` and reports `status key: unchanged`.

### Replacing or removing the status key

- **Replace** (a lost or leaked key, or routine rotation): make a new pair as in
  step 2, put its public line in `STATUS_SSH_PUBLIC_KEY` and its private key in
  `STATUS_SSH_KEY`, and run `install`; the reviewer checks the new fingerprint
  in the `validate` job. The new line replaces the old one
  (`status key: replaced`), so the old key stops working at once. It stays
  replaced even if a later step of the same install fails and is rolled back.
- **Remove**: set `STATUS_SSH_PUBLIC_KEY` to the single word `remove` and run
  `install`. The line is deleted (`status key: removed`, or `already-absent`),
  and stays deleted even if a later step fails.
  Then delete the `STATUS_SSH_KEY` secret and disable the daily workflow
  (**Actions > VPS production status > ... > Disable workflow**), or it fails
  every day. The variable can be deleted afterwards.
- Deleting or emptying the variable alone removes nothing from the server: the
  install then leaves `authorized_keys` as it is.
- Without GitHub, the deployment user or the server administrator can delete
  the line ending in `bangla-adventures-status` from `~/.ssh/authorized_keys`.

The daily workflow refuses to run if the deploy key reaches it, if
`STATUS_SSH_KEY` or `STATUS_SSH_PUBLIC_KEY` is missing, if the private key's
public half is not exactly the key in `STATUS_SSH_PUBLIC_KEY`, or if the status
key is the deploy key. Host-key pinning is the same as for the deploy. Each
message names the setting and where it belongs, for example "the secret
STATUS_SSH_KEY is missing: add it under Settings > Environments >
production-status > Environment secrets, named exactly STATUS_SSH_KEY (there
only, never as a repository secret)".

### When the daily check fails

The run log ends with one of these. SSH's own error text is never printed,
because it can name the server; the message is chosen from it instead.

| Message | What to do |
| --- | --- |
| `status: failed; codes: ...` | A job failed or is stale: see [Reading status](#reading-status) |
| "the secret DEPLOY_HOST is missing: this check runs in the production-status environment, which cannot see production environment secrets; ..." (likewise `DEPLOY_USER`, and the variable `DEPLOY_KNOWN_HOSTS`) | Add it to `production-status` with exactly that name ([step 1](#setting-up-the-status-key)), or make it a repository setting |
| "the STATUS_SSH_KEY secret is not an unencrypted private key ..." | The key has a passphrase: make a new pair, pressing Enter at both prompts, and repeat steps 3 and 4 |
| "the STATUS_SSH_KEY secret does not match the STATUS_SSH_PUBLIC_KEY variable" | The two halves come from different pairs: save both halves of one pair, then run `install` |
| "the server refused the status key: run VPS production operations install ..." | The account the check signs in to does not hold this key: between go-live steps 7 and 9, after a new pair without an install, or because `STATUS_SSH_PUBLIC_KEY` was not a repository variable when `install` ran (it then reports `status key: not requested`). Run `install` and check that it reports `status key: installed` or `already-present`. If it already reports `already-present`, the `DEPLOY_USER` secret in `production-status` names another account than in `production`, for example after a typo, which GitHub cannot show: enter it again under **Settings > Environments > production-status > Environment secrets** |
| "the server host key does not match DEPLOY_KNOWN_HOSTS and DEPLOY_HOST_FINGERPRINT ..." | The server showed a different host key. If it was rebuilt, verify the new key with the administrator before changing either setting |
| "the verified DEPLOY_KNOWN_HOSTS lines do not cover the DEPLOY_HOST secret and DEPLOY_PORT ..." | The saved line names another host or port than `DEPLOY_HOST` and `DEPLOY_PORT`: record it for the same one |
| "could not connect over SSH: check the DEPLOY_HOST secret, DEPLOY_PORT and that the server is running." | No SSH session was made: the name was not found, the port did not answer, or the first exchange failed before any key was tried |
| "the SSH connection was lost before the run finished: run it again." | The session was made but closed or stopped answering before status replied, for example during a network break or a server restart. The settings are not at fault: run the check again |

The `status` and `backup-now` actions and `install` print the same messages,
naming `DEPLOY_SSH_KEY` and the `production` environment instead; a refused
`DEPLOY_SSH_KEY` means its public half is not in the `authorized_keys` of the
account that `DEPLOY_USER` names. `backup-now` tells two dropped connections
apart, because the server reports just before it starts the backup:

| Message | What to do |
| --- | --- |
| "the SSH connection was lost during the run; that does not stop the backup, which runs on the server as ba-production-backup.service ..." | The backup was started, and the drop does not interrupt it: run `status` a few minutes later and check the `backup` line |
| "the SSH connection was lost before the server confirmed that the backup started: run backup-now again, ..." | Run `backup-now` again. Two backups never run at once: should the first have started after all, the new run waits for it to finish |

GitHub disables scheduled workflows in a public repository after 60 days
without commits, and emails a warning first; re-enable it from the Actions tab.

## Restoring

Restore from a local archive with
[Restore into the Compose deployment](BACKUP_RESTORE.md#restore-into-the-compose-deployment).
Pause the jobs first and resume them afterwards:

```sh
systemctl --user stop ba-production-backup.timer ba-production-monitor.timer ba-production-offsite.timer
# ... restore ...
systemctl --user start ba-production-backup.timer ba-production-monitor.timer ba-production-offsite.timer
```

To restore from the off-site repository, set `restic_options` and
`restic_image` as in [Configure it](#configure-it) (all of that block except its
last `init` line, including the `gs:` check), list the copies, and restore
one straight back into `backups/`. Each snapshot holds one archive, saved as
`/backups/NAME.tar.gz`, so it returns with its original owner (uid 1000) and
mode, next to the local archives:

```sh
docker --host unix:///run/user/1002/docker.sock run "${restic_options[@]}" "$restic_image" snapshots --tag bangla-adventures
docker --host unix:///run/user/1002/docker.sock run "${restic_options[@]}" \
  --mount type=bind,source=/opt/bangla-adventures/backups,target=/backups \
  "$restic_image" restore SNAPSHOT_ID --target /
```

Then continue with the restore guide from step 2, choosing that archive. Pause
the timers first, as above: a backup run keeps only the newest 14 archives.

## A stale backup lock

`backup_restore.py` marks a running backup with `backups/.bangla-backup.lock`
and stages its copy in `backups/.bangla-snapshot-*`. A backup that is killed
leaves both behind, and then every later backup, including the deploy's own
before each release, fails with "Backup lock exists".

The backup job (scheduled or `backup-now`) removes them in two places:

- after a run in which it had to kill its own helper (a timeout or a stop
  request), once the app serves again (`stale-backup-lock-cleared`);
- at the start of every run, before anything is stopped, when an earlier run
  never got as far as its own clean-up: systemd killed it after its six-minute
  stop limit, or the server lost power (`stale-backup-lock-cleared-at-start`).

The lock is removed only when it is provably stale. The run holds the deploy
lock, and every backup takes that lock first: the scheduled job, `backup-now`
(which runs the same service) and the deploy's own backup before each release.
So no other backup can be starting. A backup helper that outlived a killed run
could still be working, so the job also lists running containers by this tool's
label and by a mount of `backups/`, before it prepares that folder; if any can
write there, it leaves the folder and the lock alone and stops with
`backup-helper-running`. The monitor's receipt reader
mounts `backups/` read-only and does not count. The removal runs in a
short-lived container as uid 1000, with no network, a read-only root, no
capabilities and only `backups/` mounted.

The monitor reports a lock that exists while the deploy lock is free
(`stale-backup-lock-found`), so it shows in the next status alert. A deploy
refused by such a lock does not need a manual clean-up: run the workflow's
`backup-now` action (or wait for the next scheduled backup), then deploy again.

If the automatic clean-up fails (`stale-backup-lock`), remove them by hand.
First make sure no backup or deploy is running: the deploy lock must be free,
and `docker ps --filter volume=/opt/bangla-adventures/backups` must list no
container. `backups/` belongs to the container user, so the removal runs in a
container, under the same lock:

```sh
cd /opt/bangla-adventures
export DOCKER_HOST=unix:///run/user/1002/docker.sock
image="$(sed -n 's/^APP_IMAGE=//p' .env)"
docker ps --filter volume=/opt/bangla-adventures/backups
flock -n .deploy.lock docker run --rm --network none --user 1000:1000 \
  --mount type=bind,source=/opt/bangla-adventures/backups,target=/backups \
  --entrypoint sh "$image" -c 'rm -rf -- /backups/.bangla-backup.lock /backups/.bangla-snapshot-*'
```

`flock -n` refuses to run while a deploy or backup holds the lock.

## Failure codes

Every job writes fixed codes, never raw command output. Besides the check codes
above:

| Code | Meaning |
| --- | --- |
| `transaction-busy` | A deploy or backup holds the lock; the run was deferred (exit `75`) |
| `interrupted` | A stop request ended the run (`systemctl --user stop`, a shutdown, the unit's time limit, or a dropped connection during `install`); a backup started the app again first |
| `command-failed` | A Docker or systemd command failed, most often because the rootless Docker daemon is down or unreachable: `systemctl --user status docker` |
| `command-unavailable-or-timeout` | A command is missing or ran past its time limit |
| `operation-failed`, `install-failed` | An unexpected error; the journal (`journalctl --user -u 'ba-production-*'`) has the time it happened |
| `app-unhealthy-before-backup` | The app was not serving, so the backup did not stop it |
| `app-stop-failed`, `writers-not-stopped`, `source-still-in-use` | The app could not be stopped cleanly; it was started again |
| `backup-failed`, `backup-timeout`, `backup-unverified` | The backup command failed or took over 30 minutes, or its receipt did not match |
| `stale-backup-lock-cleared` | A killed backup helper left its lock behind and the job removed it; later backups and deploys can run |
| `stale-backup-lock-cleared-at-start` | An earlier run that never finished its clean-up left the lock; this run removed it before stopping anything. A passing run keeps this code and still counts as passed |
| `stale-backup-lock` | That lock could not be removed: remove it by hand ([A stale backup lock](#a-stale-backup-lock)) before the next deploy |
| `backup-helper-running` | A container that can write to `backups/` was still running, so its lock may be in use; nothing was stopped or removed: `docker ps --filter volume=/opt/bangla-adventures/backups` |
| `resume-failed` | The app did not answer healthy within three minutes of the restart: act now |
| `helper-cleanup-failed`, `helper-id`, `helper-identity`, `helper-name-exists` | A helper container could not be identified or removed: `docker ps --all --filter label=io.bangla.scope=production-operations` |
| `backup-directory-initialization`, `unsafe-backup-directory` | `backups/` could not be prepared, or is not a folder |
| `backup-receipt-unreadable` | The receipt could not be read through a container |
| `offsite-file-insecure`, `offsite-file-missing`, `offsite-settings-invalid` | The off-site files are unsafe, missing or contain unsupported names |
| `offsite-backend-unsupported`, `offsite-retention-invalid` | Unsupported repository, or incomplete retention settings |
| `offsite-repository-missing`, `offsite-password-wrong`, `offsite-repository-locked` | restic exit codes 10, 12 and 11 |
| `offsite-copy-failed`, `offsite-unverified`, `offsite-retention-failed`, `offsite-retention-timeout` | The copy, its snapshot check or the retention run failed; after a retention failure the copy still counts |
| `lock-state-unreadable` | The monitor could not read `/proc/locks` |
| `wrong-user`, `unsafe-deployment-directory`, `deployment-missing`, `rootless-socket`, `non-rootless-daemon`, `settings-invalid`, `app-image-missing`, `public-origin-invalid` | The server is not in the expected state |
| `missing-directory`, `unsafe-directory`, `missing-file`, `unsafe-file`, `lock-owner` | A file or folder the jobs use is missing, or not a plain file or `0700` folder owned by the deployment user (for example `ops/`, `.env` or a result file) |
| `installation-invalid` | The installed tools or units differ from the installation record: run `install` again |
| `container-id`, `ambiguous-resource`, `oversize-command-result` | Docker answered in an unexpected form |
| `invalid-report` | Shown by `status` in place of a job's codes when its result file holds codes not in the fixed form |
| `invalid-action`, `invalid-override` | The tool was run with an unknown action or an invalid `PRODUCTION_OPS_*` value |

The installer adds these:

| Code | Meaning |
| --- | --- |
| `initial-backup-deferred`, `-failed` | The first backup was deferred by a deploy that started meanwhile, or failed; its own codes follow |
| `initial-offsite-deferred`, `-failed` | The same for the first off-site copy |
| `initial-monitor-deferred`, `-failed` | The same for the first monitor run |
| `initial-operations-check` | A first run exited `0` without a fresh, passing result |
| `timer-not-enabled` | A timer did not start |
| `rollback-incomplete`, `rollback-failed` | See the `rollback` states under [Switching it on](#switching-it-on) |
| `app-unhealthy-before-install`, `user-linger-disabled` | Not installed: the app was not healthy, or the account does not linger |
| `unsafe-unit-directory-PART-PROBLEM` | A folder on the way to `~/.config/systemd/user` is unsafe, for example `unsafe-unit-directory-config-writable` |
| `user-unit-path`, `loaded-unit-path`, `unit-marker`, `unmanaged-file` | The unit folder or a unit file is not the one this installer manages |
| `user-runtime`, `user-bus` | The account's user manager is not running (it lingers, but has not started yet) |
| `payload-path`, `invalid-install-arguments`, `overrides-not-allowed` | The installer was not started by the workflow's upload |
| `status-key-request-invalid` | The uploaded key request is not in the controller's form (public keys only, an ed25519 status key, or `remove`) |
| `unsafe-ssh-directory`, `unsafe-authorized-keys` | `~/.ssh` or `authorized_keys` is a link, belongs to another account, is writable by its group or others, or the file is over 1 MiB: nothing changed |
| `authorized-keys-not-in-use` | `~/.ssh/authorized_keys` is missing or has no line of its own for the deploy key, so sshd reads keys from somewhere else: nothing changed |
| `status-key-already-authorized`, `status-key-is-deploy-key` | The status key already appears on another line, or is the deploy key: nothing changed |
| `authorized-keys-changed` | `authorized_keys` changed while the install ran; it was left as found |
| `authorized-keys-verify-failed` | The file read back after writing was not as planned; the previous contents were restored |

## Local testing

`tests/production_ops_test.py` and `tests/production-ops.test.mjs` cover the jobs
without a server. For an end-to-end check against a real Docker daemon, the
tools accept validated `PRODUCTION_OPS_*` variables (deployment folder, Docker
socket, UID, rootless requirement, off-site folder and a local test repository)
that default to the production values above. The units and workflows never set
them, the installer refuses to run with any of them, and every result records
`"overridden"`.
