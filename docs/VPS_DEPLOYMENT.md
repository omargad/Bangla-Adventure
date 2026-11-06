# Prepared client VPS

This configuration follows Faysal's 5 November 2026 handover. It is prepared for
review; creating these files does not connect to the VPS, transfer the repository,
configure GitHub Secrets, or enable deployment.

| Setting | Prepared value |
| --- | --- |
| SSH destination | `$DEPLOY_USER@$DEPLOY_HOST`, port `22` (see [Server address secrets](#server-address-secrets)) |
| Deployment directory | `/opt/bangla-adventures` |
| Docker endpoint | `unix:///run/user/1002/docker.sock` |
| Named Docker context | `rootless` |
| Container port | `3000` |
| Host binding | `127.0.0.1:3001:3000` with `APP_PORT=3001` |
| Reverse proxy | Existing Nginx; HTTPS managed by Faysal |
| Persistent data | Compose volume `bangla-data`, mounted at `/app/.data` |

The website and API run in the same Next.js container. There is no separate
backend container requiring port `8001`. Keep the application port on loopback;
Nginx handles public ports 80 and 443.

## Server address secrets

The repository is public, so the server's address and SSH account are not
written in it. Every VPS workflow (the CI deployment, SSH preflight, image
preflight, private staging and private acceptance) reads them from two secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | The VPS address given in Faysal's server handover email |
| `DEPLOY_USER` | The SSH deployment account from the same email (UID `1002` on the server) |

Either level works, and GitHub masks both:

- **`production` environment secrets** (Settings > Environments >
  `production` > Environment secrets), next to `DEPLOY_SSH_KEY`, which is
  where they are now;
- **repository secrets** (Settings > Secrets and variables > Actions >
  Repository secrets).

If a name exists at both levels, the environment's value is used. The names
must match exactly: `DEPLOY__HOST` (two underscores) or `DEPLOY_HOSTNAME` is a
different secret that no workflow reads, so the workflows treat `DEPLOY_HOST`
as missing. To check the names without showing any value, open the
environment's page or, with the GitHub CLI (it works in PowerShell too), run
`gh secret list --env production` and `gh secret list` (repository level).
`gh secret set DEPLOY_HOST --env production` prompts for the value, so it stays
out of the shell history.

An environment secret reaches only the jobs that run in that environment. Every
workflow above connects from a job in `production`. The daily status check runs
in its own `production-status` environment instead, so if these are
`production` environment secrets, add copies of both there too (or move both to
repository level); see [Alerting](PRODUCTION_OPERATIONS.md#alerting). For the
same reason the preflights' first job, which runs before the `production`
environment loads, reports them as unset at repository level when they are
environment secrets; that is expected.

Both are required. The preflight, private staging and private acceptance
workflows stop with a fixed message before any SSH contact when either is
missing or malformed, for example "the DEPLOY_HOST secret is missing or invalid
(set it as a repository secret or a production environment secret, named
exactly DEPLOY_HOST)". With `DEPLOY_ENABLED=true`, the CI deployment stops with a
message when `DEPLOY_HOST` is missing; without `DEPLOY_USER` the portable script
falls back to a `deploy` account, so set both before enabling it. The workflows'
own messages report only whether each is set. They are secrets rather than
variables because GitHub prints a step's variable values in its run log, which
is public for a public repository, while it masks secret values wherever they
appear, including inside the `DEPLOY_KNOWN_HOSTS` line. Run logs and artefacts
from before this change may still show the address; delete those runs if that
matters.

The address is not a trust anchor. Every connection still requires the server
host key to match the pinned `SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8`
fingerprint, so a wrong or altered `DEPLOY_HOST` fails host-key verification
instead of reaching another machine. The SSH and image preflights and the
private staging checks also require the account to have UID `1002` on the server.

## Settings to complete

The non-secret GitHub variable template is
[`deploy/vps.github-variables.env.example`](../deploy/vps.github-variables.env.example).
Set `DEPLOY_ENABLED` as a **repository** variable: the job gate reads it before
the production environment loads. `DEPLOY_HOST` and `DEPLOY_USER` are repository
secrets (above). Keep
`DEPLOY_ENABLED=false` until the checks below are complete. Other deployment
variables and `DEPLOY_SSH_KEY` may belong to the `production` environment. Configure an environment reviewer if the
client wants approval before each release.

`DEPLOY_SSH_KEY` must contain the existing private key corresponding to the public
key installed for the `DEPLOY_USER` account. Its expected fingerprint is
`SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ`; the public key in the email
has been checked against that fingerprint. The private key is not present in this
configuration. Use an approved secret-sharing or GitHub Secrets workflow.

`DEPLOY_KNOWN_HOSTS` needs the server's full public host-key line. The supplied
fingerprint, `SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8`, is the trust
anchor for verifying that line, not a replacement for it. Obtain the public
host-key line and compare its SHA256 fingerprint before saving it. Retain only the
matching key; unverified additional keys are rejected. Host-key collection alone
does not establish trust. This preparation has not contacted the server or
verified its actual host key.

As the deployment user, create the server `.env` from
[`deploy/vps.app.env.example`](../deploy/vps.app.env.example) with mode `0600`.
Fill `PUBLIC_ORIGIN` with the final `https://` origin once the domain is confirmed.
An empty origin deliberately prevents deployment. Keep the same
`COMPOSE_PROJECT_NAME` across releases so the data volume is reused.

The workflow selects the rootless Unix socket explicitly before any Docker
operation and checks that the daemon reports rootless mode. It does not fall
back to the system daemon. A context may be used instead through
`DEPLOY_DOCKER_CONTEXT`; configure only one selector. Registry credentials are
temporary and use the same selected daemon.

Each upload goes into its own staging directory. The server acquires one deployment
lock before reading or changing live release files, then validates the incoming
Compose configuration against the existing server `.env` and project directory.
It saves the current Compose file and deployment script before promotion. A failed
backup, file installation or health check restores those files and the previous
image together. A failed first release stops its container and removes its candidate
files; the operator-managed `.env` remains in place. If rollback itself fails, the
log identifies the private `.deploy-transaction.*` directory retained for recovery.

The GitHub workflow enforces `DEPLOY_REQUIRE_ROOTLESS=true` and
`DEPLOY_REQUIRE_PUBLIC_HEALTH=true`; repository variables cannot turn these off.
Those names are environment settings for portable/manual script use. The server
also needs `curl` and its system CA certificates for the HTTPS check.

### Narration key

Runtime narration is optional, and the ElevenLabs account and API key are the
client's responsibility. The client buys an ElevenLabs plan, or obtains
nonprofit credits from ElevenLabs, creates an API key in that account and adds
it themselves as the `ELEVENLABS_API_KEY` secret of this repository's
`production` environment (Settings > Environments > `production` > Environment
secrets), or as a repository secret (Settings > Secrets and variables >
Actions). Paste the key alone, on one line. The team never needs to see it.

Until the key is added, the site works normally with its existing recorded
audio: bundled clips, approved recordings and narration already saved still
play, and only newly generated narration reports that it is not configured.

Each deploy writes the key into the server `.env` under the deployment lock, so
nobody pastes it on the server, and a key added or changed in GitHub takes effect
at the next deploy. It travels on the SSH connection's input and never appears
on a command line, in a staged file or in the log. The optional
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` and `ELEVENLABS_DAILY_CHARACTER_LIMIT`
are variables, not secrets, written the same way. A deploy that fails puts the
previous `.env` back.

An empty or missing secret or variable leaves whatever the server `.env` already
has, so a key set there by hand keeps working; to remove a key, delete its line from
that file. The daily limit defaults to 20 000 characters. No provider credential
belongs in repository variables, source files or screenshots.

Private staging deliberately never receives the key:
`scripts/private-staging-remote.sh` refuses a staging configuration that passes any
`ELEVENLABS_*` setting to the app.

## First release

Before the domain is confirmed:

1. Confirm the destination GitHub organization/repository and permissions for
   Actions and Packages. Image names follow the current repository owner; the
   pipeline does not transfer repository ownership.
2. Confirm the VPS is `linux/amd64`, has Compose 2.17 or later, and has sufficient
   disk and memory. Verify the rootless service persists after logout/reboot and
   that the supplied socket belongs to the deployment user's daemon.
3. Verify SSH access, both fingerprint pins, rootless Docker access and the
   persistent data/backup locations using the approved credentials.
4. Agree whether the new site starts empty or receives approved existing data,
   who the first administrator is, and whether the client wants to approve each
   release (a reviewer on the `production` environment).

## Going live

Once the client confirms the domain, going live is DNS, one Nginx site, its
certificate, one server value and the deployment switch, in this order. `DOMAIN`
below is the confirmed name, for example `learn.example.org`.

1. **Domain.** The client confirms one public name; once `PUBLIC_ORIGIN` names
   it, the app accepts sign-ins from that address alone. If it is a bare domain
   (`example.org`), the app's
   HSTS header (two years, `includeSubDomains`) also commits every subdomain to
   HTTPS, so the owner confirms that first.
2. **DNS.** Point an `A` record for `DOMAIN` at the public address of the
   DEPLOY_HOST server. Add an `AAAA` record only if that server has a public
   IPv6 address that reaches Nginx. Before step 3, `dig +short DOMAIN` must
   print that address.
3. **Nginx and certificate** (Faysal). Copy
   [`deploy/nginx/bangla-adventures.conf.example`](../deploy/nginx/bangla-adventures.conf.example)
   to `/etc/nginx/sites-available/bangla-adventures.conf` and replace every
   `example.org` in it with `DOMAIN`. Get the certificate before enabling the
   site: `nginx -t` rejects its HTTPS server until certbot has created
   `/etc/letsencrypt/live/DOMAIN/`.

   The site shares ports 80 and 443 with the server's other sites, which keep
   their own files. On Nginx 1.24 the `http2` flag on its two 443 `listen` lines
   turns HTTP/2 on for every site listening on 443 there, not just this one:
   confirm that suits the other sites (or they already use it), otherwise
   remove `http2` from both lines. If no existing site on 443 is marked
   `default_server`, Nginx answers names it does not know with the first site
   file it loads, which may then be this one; mark the intended default first.

   ```sh
   sudo certbot certonly --nginx -d DOMAIN
   sudo ln -s /etc/nginx/sites-available/bangla-adventures.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot renew --dry-run
   ```

   `certonly` leaves the site file as written. certbot's nginx plugin answers
   the challenge itself and reloads Nginx after each renewal; a webroot client
   can renew through the file's `/var/www/letsencrypt` challenge location
   instead. The file also sets the 13 MB upload limit, a read timeout above
   narration's 60 s and the forwarded headers the app expects. Until the app is
   running, `https://DOMAIN/` answers `502`.
4. **Server origin.** In the server `.env`, set `PUBLIC_ORIGIN=https://DOMAIN`.
   This is the one value to fill; the next deploy starts the app with it.
5. **Health URL.** Set the GitHub variable `PUBLIC_HEALTH_URL` to
   `https://DOMAIN/api/health`. Each deploy requires `200` from it over public
   HTTPS, checked from the server; unset, the same URL is derived from
   `PUBLIC_ORIGIN`.
6. **SSH trust.** Confirm the `DEPLOY_HOST` and `DEPLOY_USER` secrets
   ([Server address secrets](#server-address-secrets)), save the verified
   `DEPLOY_KNOWN_HOSTS` line and confirm the `DEPLOY_SSH_KEY` secret is present
   ([Settings to complete](#settings-to-complete)).
7. **Enable.** First create the `production-status` GitHub environment, with
   no reviewers and only `main` allowed to deploy to it
   ([Alerting](PRODUCTION_OPERATIONS.md#alerting)): this step switches on the
   daily status check, which runs there. Then set the repository variable
   `DEPLOY_ENABLED=true`.
8. **Deploy.** Push to `main`, or run the CI workflow on `main` from the
   Actions tab, and watch its `deploy` job. The run publishes the commit's GHCR
   image and that job deploys it; an older commit is skipped, and inability to
   verify the newest commit is a failure. The job fails unless the container and
   the public health check both pass; `deploy.log` in the deployment directory
   has the server's side.
9. **Production operations.** Once that first deploy has passed, run the
   **VPS production operations** workflow on `main` with `install` and its
   confirmation ticked. It installs the deployment user's timers: a daily
   backup at 16:30 UTC (the app stops for seconds), a five-minute monitor of
   health, port exposure, disk, backup age, the public site and its
   certificate, and an off-site copy that stays inert until the client
   configures one. It runs one backup and one monitor before enabling them.
   Then give the daily status alert its own status key, which the server
   limits to reading status, never the deploy key
   ([Alerting](PRODUCTION_OPERATIONS.md#alerting)). See
   [Production operations](PRODUCTION_OPERATIONS.md).
10. **First administrator.** The agreed person opens `https://DOMAIN/grown-ups`,
   chooses Create account and keeps the recovery codes. In the deployment
   directory, with the daemon selected as in the manual administration
   commands below, the operator runs
   `docker compose exec app npm run admin:grant -- EMAIL`. That person then
   signs in again at `/grown-ups?returnTo=/admin&switchAccount=1`.
11. **Backups.** Confirm the off-site destination, schedule and retention with
    the client. Deploys and the daily backup together keep the latest 14 local
    archives in `backups/` in the deployment directory; that is a technical
    default, not agreed retention. Once the client chooses a destination, write
    its private settings file and the off-site job starts copying the newest
    verified archive each day; remote retention stays off until the client
    agrees a policy (proposed: 14 daily, 8 weekly, 6 monthly). Follow
    [Off-site copies](PRODUCTION_OPERATIONS.md#off-site-copies).

After deployment, check the real sign-in and role flows externally. Run a
controlled rollback exercise and a separate backup/restore exercise after
agreeing a suitable window. A failed deployment starts the previous image where
one exists. **Image rollback does not restore the database or uploaded files.**
The first deployment has no previous image; data restoration is a separate,
explicit operation using the saved backup.

For manual administration as the deployment user, select the same daemon before invoking
Compose, backup or recovery commands:

```sh
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///run/user/1002/docker.sock
cd /opt/bangla-adventures
docker info --format '{{json .SecurityOptions}}' # must include name=rootless
docker compose ps
```

For an approved manual image rollback, keep that environment and run
`DEPLOY_REQUIRE_PUBLIC_HEALTH=true bash deploy-remote.sh IMAGE`. Rootless bind
mounts can use subordinate host UIDs; verify that backups can be read and copied
through the same daemon before accepting the first release.

## References

- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [OpenSSH host-key collection and verification](https://man.openbsd.org/ssh-keyscan)
- [General deployment and manual recovery](DEPLOYMENT.md)
