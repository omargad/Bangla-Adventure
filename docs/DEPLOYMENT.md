# Deploy the custom Bangla Adventures application

The current product is the Next.js application with SQLite and filesystem media.
Keep **`PLATFORM_MODE=legacy`**. This is the active student, teacher, administrator
and family system. `moodle` selects a separate pilot, redirects custom portals and
returns `410 Gone` from retired APIs; do not use it for this deployment.

This runbook covers a new installation or an isolated release. The live database and
media are never part of GitHub.

**Hosting.** The application runs on the client's own server, using the container
option below behind the client's HTTPS web server. Once the server's details are set,
every change merged to `main` that passes its checks is deployed there automatically
(see [Automatic deployment](#automatic-deployment)).

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

## Other container hosts

The same `Dockerfile` runs unchanged on any host that runs a Docker image and can keep a
disk for one running copy of the app: for example Railway, Render, Fly.io, Kubernetes,
OpenShift, Coolify, Dokku, CapRover, or plain Docker or Podman. Nothing in the repository
is specific to one host.

**What the host must offer.** The database is one SQLite file and the uploaded audio sits
next to it, so the host needs:

- a persistent disk mounted at `/app/.data`. Without one, every redeploy starts empty;
- a local (block) disk, not a network share. SQLite is not safe on NFS, SMB/Azure Files,
  EFS or Cloud Storage FUSE;
- one running copy, stopped before its replacement starts (on Kubernetes,
  `strategy: Recreate`);
- HTTPS. Sign-in cookies are Secure, so plain `http://` works only at `localhost`.
  Anywhere else sign-in is refused: "Signing in needs a secure https:// address", or,
  when `PUBLIC_ORIGIN` names the https address, "The request origin could not be verified".

Heroku, DigitalOcean App Platform, Google Cloud Run and Render instances without a disk
cannot keep the data, so they are not suitable for real use; on such a host the start
log warns that `/app/.data` is not on a persistent volume.

| Setting | Value |
| --- | --- |
| Build | The repository's `Dockerfile`. When pushing a prebuilt image, build it for the host's processor, for example `docker buildx build --platform linux/amd64` on an Apple Silicon Mac |
| Start command | Leave empty, so the image's own one runs. If a host insists on one, use `scripts/docker-start.sh node --import ./scripts/close-idle-on-shutdown.mjs node_modules/next/dist/bin/next start --keepAliveTimeout 620000`. On Kubernetes and Cloud Run set only `args`, never `command` |
| Disk | Mounted at `/app/.data`. If the host mounts it elsewhere, set `DATABASE_PATH` and `MEDIA_ROOT` to absolute paths on it |
| Port | A host that sets `PORT` is followed automatically. Where the host asks for the container port instead (Fly.io `internal_port`, CapRover "Container HTTP Port", Kubernetes `targetPort`), enter 3000 |
| Health check | `/api/health` (200 only when a database query succeeds). Most hosts ignore the Dockerfile's own check, so set it on the host |
| Upload size | Lesson audio can be 12 MB. Let requests of 13 MB through any proxy in front: ingress-nginx `nginx.ingress.kubernetes.io/proxy-body-size: 13m`, Dokku `dokku nginx:set APP client-max-body-size 13m`, nginx `client_max_body_size 13m;` |
| `PUBLIC_ORIGIN` | Optional, and recommended once the address is final. Set it to the one address people use, scheme and host only (`https://learn.example.org`), and only requests from that address can sign in or save. Unset, the app accepts the address each request arrives on, for example both a platform address and a custom domain |

The image already sets `NODE_ENV`, `PORT`, `PLATFORM_MODE`, `DATABASE_PATH` and
`MEDIA_ROOT`; leave them unless the disk is mounted elsewhere. Do not set `NEXT_DIST_DIR`.
The ElevenLabs settings are only for generating audio on a developer's computer and never
go on the host.

**Users and permissions.** The app always runs as the unprivileged `node` user (uid 1000).
`scripts/docker-start.sh` adapts to how the host starts the container:

- *As root* (Railway, Render, Fly.io and others that attach their disk owned by root): it
  hands the data folders to `node`, then starts the app as `node`. If the container is
  root but may not switch users (all capabilities dropped), it stops with a message to
  run it as uid 1000.
- *As `node` or uid 1000* (Compose, Kubernetes with `runAsUser: 1000`): it starts the
  app. The disk must be writable by uid 1000; on Kubernetes set `fsGroup: 1000`.
- *As another uid in group 0* (OpenShift): the image's folders are group-writable, so
  this works too. Attach the volume at `/app/.data`, which OpenShift makes writable.

The start log names anything it finds wrong with the data folder: not on a persistent
volume, on a network filesystem, or not writable. It refuses to start with `/` or `/app`
as the data folder. On a stop the app finishes open requests before exiting.

A Kubernetes outline (OpenShift: leave out the four user and group settings, which the
platform assigns):

```yaml
spec:
  replicas: 1
  strategy: { type: Recreate }
  template:
    spec:
      securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, fsGroupChangePolicy: OnRootMismatch, runAsNonRoot: true }
      containers:
        - name: app
          image: REGISTRY/bangla-adventures:TAG
          ports: [{ containerPort: 3000 }]
          readinessProbe: { httpGet: { path: /api/health, port: 3000 } }
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
          volumeMounts: [{ name: data, mountPath: /app/.data }, { name: tmp, mountPath: /tmp }]
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: bangla-data } } # ReadWriteOnce
        - { name: tmp, emptyDir: {} }
```

With a read-only root filesystem, keep a writable `/tmp` as above: the server commands
below need it.

**Server commands.** Run them as the app's user so new files stay owned by it: in a
root shell on the host, `su node -s /bin/sh -c "npm run admin:grant -- EMAIL"`; where
the shell already runs as uid 1000 (Kubernetes `kubectl exec`), `npm run admin:grant -- EMAIL`.

**Railway.** Add a Volume with mount path `/app/.data` before storing real data (the
Trial plan's 0.5 GB volume is for testing). A deployment's Redeploy button rebuilds that
deployment's own commit; to build the newest commit, push to the branch or use
"Deploy Latest Commit" from the command palette (Ctrl+K or Cmd+K).

## Automatic deployment

Every push runs the same checks on GitHub Actions (`.github/workflows/ci.yml`), GitLab
(`.gitlab-ci.yml`) or Jenkins (`Jenkinsfile`). Each of them only calls the shared scripts in
`scripts/ci/`, so any other CI system can run them as well:

| Script | Does | Needs |
| --- | --- | --- |
| `scripts/ci/verify.sh` | Lint, unit, backup and integration tests, the production build, the type check | Node 22, Python 3 |
| `scripts/ci/e2e.sh` | The browser tests | Node 22 (and root or sudo for Chromium's libraries, or `PLAYWRIGHT_INSTALL_DEPS=0` when they are installed already) |
| `scripts/ci/container.sh IMAGE` | Builds the image and runs the container test on it | Docker with Compose |
| `scripts/ci/publish.sh` | Pushes an image to a registry, or adds a tag to one already there | Docker |
| `scripts/deploy.sh IMAGE` | Deploys an image to the server | bash, ssh |

On the default branch the pipeline then:

1. Publishes the image once its container test passes, under its commit:
   `ghcr.io/OWNER/REPOSITORY:sha-COMMIT` on GitHub (lowercase), the project's registry on GitLab.
2. Tags that same image `latest` once every check has passed. Nothing is rebuilt, so what is
   deployed is exactly what was tested.
3. Deploys it, when the server is configured (below). Until then that step is skipped.

**What a deploy does.** `scripts/deploy.sh` connects to the server over SSH and, in the
deployment folder, runs `scripts/deploy-remote.sh`, which:

- pulls the image, signing in to the registry for that pull only (nothing is stored on the server);
- if the app is running, stops it and backs up the database and media into `backups/` with the
  current version (`scripts/backup.sh`, the latest 14 kept). If the backup fails, the app is
  started again unchanged and the deploy stops;
- starts the new image with `compose.yaml` and waits up to 3 minutes for `/api/health`. If it
  does not answer, the previous image is started again and the pipeline fails;
- records the image in `deployments.log` and removes images older than the previous one.

Each deploy is offline for the backup plus a few seconds of start-up. Only one runs at a time.

**On the server, once.**

1. Install Docker Engine with the Compose plugin. Create a `deploy` user in the `docker` group.
   That group is equivalent to root on the server, so keep this account for the pipeline alone.
2. Add the public half of the deploy key to `/home/deploy/.ssh/authorized_keys`.
3. Create the deployment folder and its settings, readable by `deploy` only:

   ```sh
   sudo install -d -o deploy -g deploy -m 0750 /opt/bangla-adventures
   sudo -u deploy sh -c 'umask 077; printf "PUBLIC_ORIGIN=https://learn.example.org\nAPP_PORT=3000\n" > /opt/bangla-adventures/.env'
   ```

4. Point the HTTPS web server at `127.0.0.1:3000` (the `APP_PORT` above), allowing 13 MB
   requests for audio uploads (Caddy: `reverse_proxy 127.0.0.1:3000`).
5. On your own computer, `ssh-keyscan -H SERVER` prints the server's host key lines for
   `DEPLOY_KNOWN_HOSTS`. Check its fingerprint with the server's administrator, so the pipeline
   only ever connects to this server.

After the first deploy, register the client's administrator on the site and approve the account
from the deployment folder: `docker compose exec app npm run admin:grant -- EMAIL`.

**GitHub settings** (Settings > Secrets and variables > Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `DEPLOY_HOST` | Variable | The server's name or address. The deploy job is skipped while it is unset |
| `DEPLOY_KNOWN_HOSTS` | Variable | The `ssh-keyscan -H SERVER` lines |
| `DEPLOY_USER` | Variable | Optional; default `deploy` |
| `DEPLOY_PORT` | Variable | Optional; default `22` |
| `DEPLOY_PATH` | Variable | Optional; default `/opt/bangla-adventures` |
| `DEPLOY_SSH_KEY` | Secret | The deploy user's private key |

To approve each deploy before it runs, add required reviewers to the `production` environment
(Settings > Environments). The image stays private; during a deploy the job's own token lets the
server pull it. In an organisation that limits packages, allow this repository to publish to
GitHub Packages.

**GitLab** uses the same names under Settings > CI/CD > Variables (mark `DEPLOY_SSH_KEY` masked
and protected). Its container jobs use Docker-in-Docker, so the runner must allow privileged
containers. **Jenkins** runs the `Jenkinsfile` as a multibranch pipeline on an agent with Node 22,
Python 3, Docker with Compose, bash, git and ssh. It publishes when `REGISTRY_IMAGE` is set (for
example `ghcr.io/OWNER/REPOSITORY`) with the username and password credential `registry`, and
deploys when `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` are also set, with the SSH key credential
`deploy-ssh-key`.

**By hand, and going back.** From a Linux or macOS shell (on Windows, Git Bash or WSL) in the
repository:

```sh
DEPLOY_HOST=SERVER DEPLOY_KNOWN_HOSTS="$(ssh-keyscan -H SERVER)" DEPLOY_SSH_KEY_FILE=~/.ssh/bangla_deploy \
  REGISTRY_USER=GITHUB_USER REGISTRY_PASSWORD=TOKEN_WITH_READ_PACKAGES \
  bash scripts/deploy.sh ghcr.io/OWNER/REPOSITORY:sha-COMMIT
```

Check the printed host key against the known one first. To go back to an earlier version, deploy
its `sha-` tag the same way, or run `bash deploy-remote.sh IMAGE` in the deployment folder on the
server (`deployments.log` lists earlier images). If a newer version has already changed the data
in a way the earlier one cannot read, restore the backup taken just before it, from `backups/`
([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).

## Caching, security headers and new releases

The app sets these itself wherever it runs; the reverse proxy does not need to add them.

- **Caching.** `proxy.ts` sets `Cache-Control` on every response it lets through
  (`cacheControl` in `lib/learning-policy.ts`). Hashed build files under `/_next/static`
  keep for a year: `public` when signed-out pages load them, `private` when only
  signed-in visitors may. Public images, icons, the manifest and `robots.txt` keep for a
  day, and the adventure page's two pictures for a day in the signed-in browser only.
  `/sw.js` is checked again on every load. Pages, API data, errors and other gated files
  such as `/audio` are `private, no-store`. Signing out asks the browser to clear the
  site's cache (`Clear-Site-Data`).
- **Security headers.** `next.config.ts` adds them to every response, including the
  proxy's own 401, 403, 410 and redirects: HSTS, a Content-Security-Policy limited to
  `frame-ancestors`, `object-src`, `base-uri` and `form-action`, a Permissions-Policy
  that keeps the lesson microphone working, `X-Frame-Options`, `X-Content-Type-Options`
  and `Referrer-Policy`. `X-Powered-By` is off.
- **New releases.** The release id is the build's `BUILD_ID` file in `NEXT_DIST_DIR`
  (`lib/release.ts`), which is one more reason to build and run with the same
  `NEXT_DIST_DIR`. Pages behind sign-in compare it with `/api/auth/session` on focus and
  every minute and, once a new release is live, show a "new version" notice with a
  Reload button. They never reload by themselves, so a draft or a one-time password on
  screen is not lost; following a link also loads the new release. The public welcome,
  grown-ups, student sign-in and safety pages do not check and show the new release on
  their next load.

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

**Locked out.** Adults reset a forgotten password themselves with a recovery code. If
the only administrator has lost both, run the reset command the same way as the grant,
against the same database (`npm run admin:reset-password -- ADMIN_EMAIL` natively, as
the app account with its `DATABASE_PATH`), or for Compose:

```sh
docker compose exec app npm run admin:reset-password -- ADMIN_EMAIL
```

It prints a temporary password once, signs the account out everywhere and records the
reset in the audit log without the password. Signing in with it leads straight to
choosing a new password, and fresh recovery codes follow. It also takes a student's
username.

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

With [automatic deployment](#automatic-deployment), the pipeline does the backup, the switch,
the health check and the switch back on failure for the container option; still check the role
journeys in [`ACCEPTANCE.md`](ACCEPTANCE.md) after a release. By hand, for the native service:

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
