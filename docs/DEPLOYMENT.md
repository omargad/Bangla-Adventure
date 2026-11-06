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

Put the HTTPS proxy in front of `127.0.0.1:3000`, or the configured `APP_PORT`
(`3001` in the prepared VPS settings).
The native Caddy example uses port `3300`; change its upstream for Compose.
The Nginx site [`deploy/nginx/bangla-adventures.conf.example`](../deploy/nginx/bangla-adventures.conf.example)
uses `3001` and sets the upload size, read timeout and forwarded headers the app expects.
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
| Upload size | Lesson audio can be 12 MB. Let requests of 13 MB through any proxy in front: ingress-nginx `nginx.ingress.kubernetes.io/proxy-body-size: 13m`, Dokku `dokku nginx:set APP client-max-body-size 13m`, nginx `client_max_body_size 13m;` (set in [`deploy/nginx/bangla-adventures.conf.example`](../deploy/nginx/bangla-adventures.conf.example)) |
| `PUBLIC_ORIGIN` | Optional, and recommended once the address is final. Set it to the one address people use, scheme and host only (`https://learn.example.org`), and only requests from that address can sign in or save. Unset, the app accepts the address each request arrives on, for example both a platform address and a custom domain |

The image already sets `NODE_ENV`, `PORT`, `PLATFORM_MODE`, `DATABASE_PATH` and
`MEDIA_ROOT`; leave them unless the disk is mounted elsewhere. Do not set `NEXT_DIST_DIR`.
Bundled audio in `public/audio` plays without a runtime voice key. Optional automatic
narration for newly approved topics and class activities needs the client's
`ELEVENLABS_API_KEY` in the server's private runtime environment. Never use a
`NEXT_PUBLIC_` key or commit credentials; see the Bangla audio section below.

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

Every push runs the same checks on whichever CI/CD system the repository uses: GitHub Actions,
GitLab, Jenkins, Bitbucket Pipelines, CircleCI, Azure Pipelines, TeamCity, AWS CodeBuild and
CodePipeline, Google Cloud Build or Travis CI. Each has a small file in the repository that only
calls the shared scripts in `scripts/ci/`; [CI_CD.md](CI_CD.md) lists the files and what to set on
each system. The scripts:

| Script | Does | Needs |
| --- | --- | --- |
| `scripts/ci/verify.sh` | Lint, unit, backup and integration tests, the production build, the type check | Node 22, Python 3 |
| `scripts/ci/e2e.sh` | The browser tests | Node 22 (and root or sudo for Chromium's libraries, or `PLAYWRIGHT_INSTALL_DEPS=0` when they are installed already) |
| `scripts/ci/container.sh IMAGE` | Builds the image and runs the container test on it | Docker with Compose |
| `scripts/ci/publish.sh` | Pushes an image to a registry, or adds a tag to one already there | Docker |
| `scripts/deploy.sh IMAGE` | Deploys an image to the server | bash, ssh, ssh-keygen; curl on the server for public health |
| `scripts/ci/newest.sh BRANCH` | Says whether this commit is still the newest one of BRANCH on the remote; the pipelines mark an image `latest` and deploy it only then | git |

On the default branch the pipeline then:

1. Publishes the image once its container test passes, under its commit:
   `ghcr.io/OWNER/REPOSITORY:sha-COMMIT` on GitHub (lowercase), the project's registry on GitLab.
2. Tags that same image `latest` once every check has passed. Nothing is rebuilt, so what is
   deployed is exactly what was tested.
3. Deploys it when the server is configured and `DEPLOY_ENABLED=true`. Until then that step is skipped.

For Faysal's prepared rootless VPS, use [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md)
and the supplied non-secret settings templates. That server uses host port `3001`,
the existing rootless daemon, and Nginx; the generic rootful setup below does not
apply to it.

**What a deploy does.** `scripts/deploy.sh` connects to the server over SSH, uploads
`compose.yaml` and `scripts/deploy-remote.sh` into a unique staging directory beneath the
deployment folder and runs that staged script. It acquires the deployment lock before touching
live release files and validates Compose against the existing project directory and `.env`.
That run carries on if the SSH
connection drops, so a dropped connection does not stop a deploy halfway, and it writes its output
to `deploy.log` in the deployment folder. `deploy-remote.sh`:

- checks that Compose is 2.17 or newer and that the health timeout is a number, before it stops
  anything;
- writes any narration settings it was given (`ELEVENLABS_*`, below) into `.env`, first saving
  a private copy of the previous file that a failed deploy puts back;
- pulls the image, signing in to the registry with a temporary configuration for that pull only
  (nothing is stored on the server). Without a registry user, an image already on the server is
  used as it is;
- if the app's container exists and there is a database, stops the app and backs up the database
  and media into `backups/` with the current version (`scripts/backup.sh`, the latest 14 kept).
  When it takes no backup, for example on the first deploy, it says why. If the backup fails, the
  app is started again unchanged and the deploy stops;
- saves the previous Compose file and deploy script, then installs both candidate files under
  the lock. Upload and validation failures leave the working files alone;
- starts the new image with `compose.yaml`, waits up to 3 minutes for container readiness,
  then checks `/api/health` inside the container and through public HTTPS (required on GitHub).
  If a check or file installation fails, the previous Compose file, deployment script and image
  are restored together and the pipeline fails. If that fails too,
  it says the site is down: start an earlier image by hand (below);
- records the image in `deployments.log` and removes images older than the previous one.

Each deploy is offline for the backup plus a few seconds of start-up. Only one runs at a time.
Failed first releases stop the candidate and remove their installed release files without
removing operator settings. Successful rollback removes temporary release files; failed
rollback retains the saved configuration in the directory named in the log for recovery.
Image/configuration rollback never restores database or media contents.

**On the server, once.**

1. Use an x86-64 (amd64) server: the pipeline publishes `linux/amd64` images. Install Docker
   Engine with the Compose plugin, version 2.17 or newer (`docker compose version`). Create a
   `deploy` user in the `docker` group. That group is equivalent to root on the server, so keep
   this account for the pipeline alone.
2. Add the public half of the deploy key to `/home/deploy/.ssh/authorized_keys`.
3. Create the deployment folder and its settings, readable by `deploy` only:

   ```sh
   sudo install -d -o deploy -g deploy -m 0750 /opt/bangla-adventures
   sudo -u deploy sh -c 'umask 077; printf "PUBLIC_ORIGIN=https://learn.example.org\nAPP_PORT=3000\n" > /opt/bangla-adventures/.env'
   ```

4. Point the HTTPS web server at `127.0.0.1:3000` (the `APP_PORT` above), allowing 13 MB
   requests for audio uploads (Caddy: `reverse_proxy 127.0.0.1:3000`; Nginx:
   [`deploy/nginx/bangla-adventures.conf.example`](../deploy/nginx/bangla-adventures.conf.example)
   with its upstream port set to `APP_PORT`).
5. On your own computer, record the server's host key, so the pipeline only ever connects to this
   server. Use the server's SSH port (`DEPLOY_PORT`, usually 22):

   ```sh
   ssh-keyscan -p PORT -H SERVER > server.keys
   ssh-keygen -lf server.keys
   ```

   Compare the SHA256 fingerprints it prints with the server's administrator, who can list them
   on the server with `for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key"; done`.
   Retain only the host-key line matching the agreed `DEPLOY_HOST_FINGERPRINT` pin;
   the contents of `server.keys` are then the value of `DEPLOY_KNOWN_HOSTS`.

After the first deploy, register the client's administrator on the site and approve the account
from the deployment folder: `docker compose exec app npm run admin:grant -- EMAIL`.

**GitHub settings** (Settings > Secrets and variables > Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `DEPLOY_ENABLED` | Repository variable | Must be exactly `true` to enable deployment. Leave unset or `false` while preparing access, the domain and backups |
| `DEPLOY_HOST` | `production` environment or repository secret | The server's name or address. A secret, so that GitHub masks it in the run logs of this public repository ([Server address secrets](VPS_DEPLOYMENT.md#server-address-secrets)). A deploy with `DEPLOY_ENABLED=true` and no `DEPLOY_HOST` stops with a message |
| `DEPLOY_KNOWN_HOSTS` | Variable | The contents of `server.keys` (step 5 above) |
| `DEPLOY_HOST_FINGERPRINT` | Variable | Expected SHA256 fingerprint; every supplied host-key line must match this pin |
| `DEPLOY_KEY_FINGERPRINT` | Variable | Expected SHA256 fingerprint of the deployment key's public half |
| `DEPLOY_USER` | `production` environment or repository secret | The SSH account on the server; required for the prepared VPS, whose account is in the server handover email. A secret for the same reason as `DEPLOY_HOST`. When unset the portable script uses `deploy` |
| `DEPLOY_PORT` | Variable | Optional; default `22` |
| `DEPLOY_PATH` | Variable | Optional; default `/opt/bangla-adventures` |
| `DEPLOY_DOCKER_HOST` | Variable | Explicit daemon endpoint; for the prepared VPS, `unix:///run/user/1002/docker.sock` |
| `DEPLOY_DOCKER_CONTEXT` | Variable | Alternative named context; use only one Docker selector |
| `DEPLOY_REQUIRE_ROOTLESS` | Fixed workflow setting | GitHub enforces `true`; portable scripts accept this environment setting and default to `true` |
| `DEPLOY_REQUIRE_PUBLIC_HEALTH` | Fixed workflow setting | GitHub enforces `true`; portable scripts accept this environment setting and default to `false` |
| `PUBLIC_HEALTH_URL` | Variable | Optional HTTPS health URL; defaults to the server's `PUBLIC_ORIGIN` plus `/api/health` |
| `DEPLOY_SSH_KEY` | Secret | The deploy user's private key |
| `STATUS_SSH_KEY` | `production-status` environment secret | The private half of the daily production status check's own key, which the server limits to reading status; never the deploy key. That environment also needs `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_KNOWN_HOSTS` when they are `production` environment settings ([Alerting](PRODUCTION_OPERATIONS.md#alerting)) |
| `STATUS_SSH_PUBLIC_KEY` | Repository variable | The one line of that key's `status_key.pub` (`ssh-ed25519 AAAA... bangla-adventures-status`). The reviewer-approved production operations `install` adds it to the server's `authorized_keys`, restricted to running status; `remove` makes the next install delete that line |
| `ELEVENLABS_API_KEY` | `production` environment or repository secret | Optional, and the client's responsibility: the client buys an ElevenLabs plan, or obtains nonprofit credits from ElevenLabs, and adds their own key here; the team never needs to see it. Written into the server `.env` on each deploy; empty leaves the server's own value. Until it is added, the site works normally with its existing recorded audio and only newly generated narration reports that it is not configured ([Narration key](VPS_DEPLOYMENT.md#narration-key)) |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_DAILY_CHARACTER_LIMIT` | Variable | Optional narration settings, written the same way |

The configurable variables other than `DEPLOY_ENABLED`, and the `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and
`ELEVENLABS_API_KEY` secrets, may be set on the `production` environment instead (Settings > Environments); GitHub
masks secrets at either level, and an environment value replaces a repository one of the same name. Names must match
exactly (`DEPLOY__HOST` is not read). Only jobs in that environment see its settings, so the daily status check's
`production-status` environment needs its own copies of those it reads ([Alerting](PRODUCTION_OPERATIONS.md#alerting);
[Server address secrets](VPS_DEPLOYMENT.md#server-address-secrets)). To approve each deploy before it runs,
add required reviewers to that environment. Only the newest commit on the default branch is marked
`latest` and deployed: a run whose commit is no longer the newest, such as an old run started
again, skips those steps with a notice. If the newest commit cannot be verified,
the check fails and the release is not promoted or deployed.

The image is a package of the repository's owner. It takes the repository's visibility when the
workflow first creates it, so it is public while the repository is public; to change that, open
the package's Package settings > Danger Zone > Change visibility. The deploy job's token lets the
server pull it either way. If publishing is denied, open the package's settings and, under Manage
Actions access, give this repository the Write role, or delete a stale package of that name so the
workflow creates it again, linked to this repository. After the repository is transferred, the
image is `ghcr.io/NEWOWNER/REPOSITORY`.

**Other CI/CD systems** use the same settings under their own names and places; see
[CI_CD.md](CI_CD.md). Where a system's secrets hold a single line, `DEPLOY_SSH_KEY_BASE64` and
`DEPLOY_KNOWN_HOSTS_BASE64` take the key and the host keys as one line of base64.
They send the narration settings by giving `scripts/deploy.sh` the same `ELEVENLABS_*` variables.
A deploy step sees a secret only where its system passes it on: Azure Pipelines and Jenkins pass
only the secrets their file maps or binds, Google Cloud Build only the settings its file lists, and
none of the three names these yet. There, add `ELEVENLABS_API_KEY` (on Cloud Build, every
`ELEVENLABS_*` setting) to the deploy step, or set them in the server `.env` by hand.

**By hand, and going back.** From a Linux or macOS shell (on Windows, Git Bash or WSL) in the
repository, with `server.keys` from step 5 above:

```sh
unset ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID ELEVENLABS_MODEL_ID ELEVENLABS_DAILY_CHARACTER_LIMIT
DEPLOY_ENABLED=true DEPLOY_HOST=SERVER DEPLOY_KNOWN_HOSTS="$(cat server.keys)" DEPLOY_SSH_KEY=~/.ssh/bangla_deploy \
  DEPLOY_HOST_FINGERPRINT=EXPECTED_SERVER_SHA256 DEPLOY_KEY_FINGERPRINT=EXPECTED_DEPLOY_KEY_SHA256 \
  DEPLOY_USER=SERVER_USER DEPLOY_DOCKER_HOST=unix:///run/user/1002/docker.sock \
  DEPLOY_REQUIRE_ROOTLESS=true DEPLOY_REQUIRE_PUBLIC_HEALTH=true \
  REGISTRY_USER=GITHUB_USER REGISTRY_PASSWORD=TOKEN_WITH_READ_PACKAGES \
  bash scripts/deploy.sh ghcr.io/OWNER/REPOSITORY:sha-COMMIT
```

`DEPLOY_KNOWN_HOSTS` and `DEPLOY_SSH_KEY` each take either the text itself or the path of a file
holding it. The registry settings are needed only for a private image. Any `ELEVENLABS_*` variable
left in the shell, such as a key exported for offline audio generation
([MEDIA_REVIEW.md](MEDIA_REVIEW.md)), would replace that setting in the server `.env`, so the
first line clears them; to send the client's settings on purpose, set them after it. If the
connection drops, the deploy still finishes on the server; `deploy.log` in the deployment folder
shows how it went.
The example selects Faysal's rootless daemon. For a separately approved rootful host,
explicitly use `DEPLOY_DOCKER_HOST=unix:///var/run/docker.sock`,
`DEPLOY_REQUIRE_ROOTLESS=false` and that host's user and fingerprint pins.

To go back to an earlier version, deploy its `sha-` tag the same way, or run `deploy-remote.sh` in
the deployment folder on the server (`deployments.log` lists earlier images):

```sh
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///run/user/1002/docker.sock
export DEPLOY_REQUIRE_ROOTLESS=true DEPLOY_REQUIRE_PUBLIC_HEALTH=true
bash deploy-remote.sh IMAGE                                     # an image still on the server
printf '%s' TOKEN | bash deploy-remote.sh IMAGE REGISTRY_USER   # one to pull from a private registry
```

The server keeps the running image and the one before it, so going back one version needs no
token. If the site is down because the current version cannot start at all, add `'' 0` after
`IMAGE` to skip the backup, which would otherwise need that version to run. If a newer version has already changed the data in a way the earlier one cannot read,
restore the backup taken just before it, from `backups/`
([Restore into the Compose deployment](BACKUP_RESTORE.md#restore-into-the-compose-deployment)).

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

The bundled Bangla pronunciation clips are files in `public/audio`, built into each
release and playable without a runtime voice key. Offline generation uses a private
operator environment; its `ELEVENLABS_VOICE_ID_BN` and `ELEVENLABS_VOICE_ID_EN`
overrides are specific to the generation script.

Automatic narration of newly approved topic text and class activity instructions
or question prompts is optional. It calls ElevenLabs from the server on first use
and saves audio on the persistent media volume. Enabling it requires the client's
`ELEVENLABS_API_KEY` in the private server environment, with optional
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` and `ELEVENLABS_DAILY_CHARACTER_LIMIT`.
For Compose, the operator-managed server `.env` supplies these values to the app
container; the automatic deployment can write them there from pipeline secrets and
variables ([Automatic deployment](#automatic-deployment)). Keep that file private;
never commit it or expose a key through a `NEXT_PUBLIC_` variable. Without a key,
bundled clips and authorized saved narration still play, while new narration reports
that it is not configured.

The ElevenLabs account, plan and API key belong to the **client**, not the hosting
operator or student team. The client controls provider spending and key rotation.

Follow [`MEDIA_REVIEW.md`](MEDIA_REVIEW.md#a-better-bangla-computer-voice-elevenlabs):
confirm the plan's licence covers audio in a schools app, run the dry run, make
and compare the samples, generate every clip, have a native Bangla speaker review
them, then commit `public/audio` with its `voice-manifest.json`. Deploy that
commit as a normal release (build, verify, switch `current`). Runtime narration has
its own [configuration and access rules](MEDIA_REVIEW.md#automatic-narration-of-teacher-content).

## Acceptance and optional Moodle

Use [`ACCEPTANCE.md`](ACCEPTANCE.md) to record reviewers, release scope, evidence
and remaining decisions. Tests do not approve educational accuracy, rights, age
suitability, accessibility or safeguarding. Preserve draft notices and publication
gates until the responsible reviewers provide evidence.

The Moodle pilot has its own [`runbook`](../infra/moodle/README.md) and release
validator. Its pending human-review gates are not a database dependency of the
custom app. Do not switch modes to satisfy this runbook or bypass a pilot gate.
