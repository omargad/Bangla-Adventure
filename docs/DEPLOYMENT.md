# Deploy the custom Bangla Adventures application

The current product is the Next.js application with SQLite and filesystem media.
Keep **`PLATFORM_MODE=legacy`**. This is the active student, teacher, administrator
and family system. `moodle` selects a separate pilot, redirects custom portals and
returns `410 Gone` from retired APIs; do not use it for this deployment.

This runbook covers a new installation or an isolated release. Files in
`infra/current-server/` record the existing host's configuration; they are not a
portable installation. The live database and media are never part of GitHub.

## Prerequisites

- A client-approved Linux host, named operator and recovery contact.
- Node.js 22 and npm for native deployment, or Docker with Compose for containers.
  Python 3 is required wherever the backup/restore commands run.
- A public HTTPS address and reverse proxy. Keep the app listener on loopback;
  never disable secure cookies to make production login work over HTTP.
- Persistent database **and media** storage, an approved encrypted off-server
  backup destination and an agreed restore process.
- One application instance: SQLite, filesystem media and in-memory rate limiting
  are the current design. A Codespace is a development environment.

Choose either the native service or Compose. Do not run both against one database.

## Build and verify an isolated release

Check out an approved commit from
[`omargad/Bangla-Adventure`](https://github.com/omargad/Bangla-Adventure).
For native deployments, use a new `/opt/bangla-adventures/releases/<commit>`
directory for each release. Never rebuild the directory used by a running process.

```sh
npm ci
bangla_build_state="$(mktemp -d)"
PLATFORM_MODE=legacy NEXT_DIST_DIR=.next \
  DATABASE_PATH="$bangla_build_state/build.db" \
  MEDIA_ROOT="$bangla_build_state/media" npm run build
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
NEXT_DIST_DIR=.next-test npm run test:integration
```

Use the same `NEXT_DIST_DIR` for production build and runtime. The browser suite
builds `.next-test`; the API command above reuses it with temporary data. Do not run
type checking concurrently with builds. Never point tests at production data or
the live URL. Record the commit, runtime, commands, results and unavailable checks.

## Native service

Review the portable examples in [`infra/custom-app/`](../infra/custom-app/).
They use this layout:

| Path | Purpose |
| --- | --- |
| `/opt/bangla-adventures/releases/<commit>` | Immutable source, dependencies and `.next` build |
| `/opt/bangla-adventures/current` | Symlink selecting the verified release |
| `/etc/bangla-adventures/app.env` | Operator-managed environment, not committed |
| `/var/lib/bangla-adventures/bangla-adventures.db` | Persistent database |
| `/var/lib/bangla-adventures/media` | Persistent uploaded media |
| `/var/cache/bangla-adventures` | Writable Next.js cache |

1. Create a dedicated `bangla-adventures` system account with no interactive login.
   Install the release as a root/operator-owned tree readable by that account.
   Create its `.next/cache` mount target and point `current` to the release.
2. Copy `infra/custom-app/app.env.example` to `/etc/bangla-adventures/app.env`,
   owned by root with mode `0600`. Replace the example public origin with the
   actual HTTPS address. Keep absolute data paths and `PLATFORM_MODE=legacy`.
   Systemd reads this file; operator shell commands do not inherit it automatically.
3. Create `/var/lib/bangla-adventures/media` and `/var/cache/bangla-adventures`,
   owned by the app account with mode `0750`. The service declares its state/cache
   directories. Database tables are created automatically on first use; do not
   create default credentials or load test fixtures into production.
4. Review/install `infra/custom-app/bangla-adventures.service` under
   `/etc/systemd/system/`. Verify `/usr/bin/node` is Node.js 22, then run
   `systemd-analyze verify` against the installed unit before enabling it. The app
   binds `127.0.0.1:3300`; only state and cache are writable.
5. Add the reviewed `infra/custom-app/Caddyfile.example` site block to the existing
   proxy configuration, replacing the example domain and preserving other sites.
   Validate the complete Caddy configuration before reload. Verify HTTPS and
   certificate renewal for the actual public address.
6. Start the service. Check `http://127.0.0.1:3300/api/health` locally and the
   corresponding public HTTPS endpoint externally. It returns `200` only when a
   database query succeeds. Check the service journal if readiness fails.

`Restart=always` recovers an exited process. Also configure external HTTPS/readiness
monitoring and alerts for disk space, certificate expiry and backup age. A healthy
app is not proof that backups can be restored.

## Container option

`compose.yaml` runs the same custom app with a persistent named volume. Set the
actual HTTPS origin in the shell or an uncommitted `.env`, then:

```sh
export PUBLIC_ORIGIN=https://YOUR_PUBLIC_HOST
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Put the HTTPS proxy in front of `127.0.0.1:3000`, or the configured `APP_PORT`.
The native Caddy example uses port `3300`; change its upstream for Compose.
Keep the same Compose project name so recreations reuse the same named volume.
Never run `docker compose down -v` during an upgrade. The CI Docker smoke test
validates a disposable container; record its actual result before accepting a
release, and separately verify the production host configuration.

## Render (current hosting)

Since 30 October 2026 the live site is <https://bangla-adventure.onrender.com>, a Render
**Web Service** built from this repository's `main` branch. Render was chosen because it
runs the app unchanged, keeps one persistent disk and needs no server administration.
Vercel and other serverless hosts cannot keep the SQLite database or uploaded media.

| Setting | Value |
| --- | --- |
| Language / runtime | Docker, branch `main`, root directory empty |
| Region | Singapore (closest to the client in Australia) |
| Instance | Starter (0.5 CPU, 512 MB); one instance. The free plan has no disk, so every restart would wipe all data |
| Dockerfile Path | `./Dockerfile.render`; build context `.` |
| Docker Command / Pre-Deploy Command | Empty: `Dockerfile.render` starts the app, and the database updates itself on start |
| Health Check Path | `/api/health` (200 only when a database query succeeds) |
| Environment | `PORT=10000`, `PUBLIC_ORIGIN=https://bangla-adventure.onrender.com` (the database, media and `PLATFORM_MODE` settings come from the image) |
| Disk | 1 GB mounted at `/app/.data`: the database and uploaded media |
| Auto-Deploy | **After CI checks pass**, so a commit with failing checks never reaches the live site |

`Dockerfile.render` is the normal image with a different start: Render mounts the disk
owned by root, so `scripts/render-start.sh` hands `/app/.data` to the unprivileged
`node` user and then runs the app as `node`. Keep the part above its RENDER section
identical to `./Dockerfile` when either changes.

**First administrator.** Register the client's account on the site (it waits for
approval), then in the service's **Shell** tab run:

```sh
scripts/render-run-as-app.sh npm run admin:grant -- REGISTERED_EMAIL
```

Run every Shell command that touches the database through
`scripts/render-run-as-app.sh`, never directly as root, so new database files stay
owned by `node`.

**Upgrades and rollback.** Merge to `main`; once CI passes Render builds and deploys
the new commit. The single instance restarts, so expect a short interruption. To go
back, use **Rollback** on an earlier deploy in the Render dashboard, subject to the
schema caution in *Upgrade and rollback* below.

**Backups.** Render snapshots the disk automatically every 24 hours and keeps
snapshots for at least seven days; a restore rolls back the whole disk. Render warns
that a disk snapshot may not be a consistent copy of a database, so also make
database-consistent backups with the app's tool (not yet exercised on Render):

1. Turn on **Maintenance Mode** in the service settings so no one can write.
2. In the Shell, run
   `scripts/render-run-as-app.sh bash scripts/backup.sh /app/.data/backups 3 --application-stopped`.
3. Turn Maintenance Mode off.
4. Copy the archive to the client's own storage. Archives on the same disk are not an
   off-site backup, and they use the 1 GB; until a copy off Render is set up and a
   restore has been rehearsed, off-site backup remains open.

Ownership: the Render account, its billing and the service belong in the client's
hands at handover (transfer the service or recreate it with these settings).

## First administrator and recovery

1. Confirm the client's intended account identity. Have that person register an
   adult account through HTTPS and privately retain the displayed recovery codes.
   Self-registered accounts wait for administrator approval, so this one cannot
   sign in until the next step.
2. Run the grant command against the **same database as the app**. It grants the
   administrator role and approves the account. From a native release directory,
   as the app account:

   ```sh
   sudo -u bangla-adventures env \
     DATABASE_PATH=/var/lib/bangla-adventures/bangla-adventures.db \
     npm run admin:grant -- YOUR_REGISTERED_EMAIL
   ```

   For Compose, use its configured database and runtime user:

   ```sh
   docker compose exec app npm run admin:grant -- YOUR_REGISTERED_EMAIL
   ```

3. Sign in again at `/grown-ups?returnTo=/admin&switchAccount=1`. Promotion revokes
   previous sessions. Public registration never grants admin access; no default
   administrator credentials exist.

Approve self-registered students, parents and teacher requests explicitly from the
Users page queue. Accounts an administrator creates, and passwords an administrator
resets, use a generated temporary password shown once on a printable sheet; the
owner must replace it at first sign-in. Staff allocate approved students to classes;
admins link approved parents to approved student accounts. Parents have
read-only academic access. Recovery codes are the implemented password-reset
mechanism for adults; this release does not require SMTP or promise email reset.
Transfer recovery material privately.

## Backups and existing data

Follow [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). Set `DATABASE_PATH` and `MEDIA_ROOT`
explicitly so backups target live state rather than an obsolete `.data` directory.
Stop application writers for a consistent database/media pair, verify the archive,
encrypt it and copy it to the approved separate storage. Record the destination
owner, schedule, retention, backup-age alerts and recovery-key custodian. Until
configured and demonstrated, off-server backup remains an open deployment task.

Restore first into a **new** directory for an isolated recovery drill; the restore
tool does not overwrite running state. A new host continuing the existing site
needs its verified database **and matching media**, transferred privately with
correct ownership. An empty database is appropriate only for a new installation.

## Upgrade and rollback

1. Build/test a new release directory and take a verified pre-upgrade data/media
   backup. Record the previous release path and schema compatibility constraints.
2. Stop the app, switch `current` to the verified release, and restart. Leave the
   persistent database/media paths unchanged. Each release owns its `.next`;
   the service cache target remains `current/.next/cache`.
3. Check HTTPS readiness and the role journeys in [`ACCEPTANCE.md`](ACCEPTANCE.md)
   before ending maintenance. Retain the previous code release and backup.
4. On failure, stop the app before switching back. Code rollback is valid only
   when the previous release understands the current schema. If data rollback is
   necessary, restore a verified backup into a new location and explicitly account
   for writes made after the backup; they would otherwise be lost.

The existing host in `infra/current-server/` has a different mount layout and a
named `NEXT_DIST_DIR`. Retain it unless a separate migration is planned; update
both its build-directory setting and cache bind target together. Do not overwrite
its live service with the new-host example without adapting and reviewing it.

## Bangla audio (ElevenLabs)

The Bangla pronunciation clips are files in `public/audio`, built into each
release; the running app never calls a text-to-speech service and needs no
voice key. The client chose ElevenLabs to make better clips. Its account, plan
and API key belong to the **client**, not the hosting operator or the student
team. Do not put `ELEVENLABS_API_KEY` (or `ELEVENLABS_VOICE_ID_BN` /
`ELEVENLABS_VOICE_ID_EN`) in `app.env`, `.env` or Compose: they are set only in
the shell of the person who generates the clips, on their own computer.

Follow [`MEDIA_REVIEW.md`](MEDIA_REVIEW.md#a-better-bangla-computer-voice-elevenlabs):
confirm the plan's licence covers audio in a schools app, run the dry run, make
and compare the samples, generate every clip, have a native Bangla speaker review
them, then commit `public/audio` with its `voice-manifest.json`. Deploy that
commit as a normal release (build, verify, switch `current`); nothing else on the
server changes.

## Acceptance and optional Moodle

Use [`ACCEPTANCE.md`](ACCEPTANCE.md) to record reviewers, release scope, evidence
and remaining decisions. Tests do not approve educational accuracy, rights, age
suitability, accessibility or safeguarding. Preserve draft notices and publication
gates until the responsible reviewers provide evidence.

The Moodle pilot has its own [`runbook`](../infra/moodle/README.md) and release
validator. Its pending human-review gates are not a database dependency of the
custom app. Do not switch modes to satisfy this runbook or bypass a pilot gate.
