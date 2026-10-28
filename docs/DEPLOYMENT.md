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

## First administrator and recovery

1. Confirm the client's intended account identity. Have that person register an
   adult account through HTTPS and privately retain the displayed recovery codes.
2. Run the grant command against the **same database as the app**. From a native
   release directory, as the app account:

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

Approve teacher requests explicitly. Staff allocate students to classes; admins
link parents to exact registered student accounts. Parents have read-only academic
access. Recovery codes are the implemented password-reset mechanism; this release
does not require SMTP or promise email reset. Transfer recovery material privately.

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

## Acceptance and optional Moodle

Use [`ACCEPTANCE.md`](ACCEPTANCE.md) to record reviewers, release scope, evidence
and remaining decisions. Tests do not approve educational accuracy, rights, age
suitability, accessibility or safeguarding. Preserve draft notices and publication
gates until the responsible reviewers provide evidence.

The Moodle pilot has its own [`runbook`](../infra/moodle/README.md) and release
validator. Its pending human-review gates are not a database dependency of the
custom app. Do not switch modes to satisfy this runbook or bypass a pilot gate.
