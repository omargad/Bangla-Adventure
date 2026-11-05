# Prepared client VPS

This configuration follows Faysal's 5 November 2026 handover. It is prepared for
review; creating these files does not connect to the VPS, transfer the repository,
configure GitHub Secrets, or enable deployment.

| Setting | Prepared value |
| --- | --- |
| SSH destination | `deployer@203.0.113.10`, port `22` |
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

## Settings to complete

The non-secret GitHub variable template is
[`deploy/vps.github-variables.env.example`](../deploy/vps.github-variables.env.example).
Set `DEPLOY_ENABLED` and `DEPLOY_HOST` as **repository** variables: the job gate
reads both before the production environment loads. Keep `DEPLOY_ENABLED=false`
until the checks below are complete. Other deployment variables and `DEPLOY_SSH_KEY` may
belong to the `production` environment. Configure an environment reviewer if the
client wants approval before each release.

`DEPLOY_SSH_KEY` must contain the existing private key corresponding to the public
key installed for `deployer`. Its expected fingerprint is
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

As `deployer`, create the server `.env` from
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

Runtime narration is optional. If the release includes it, put the client's
`ELEVENLABS_API_KEY` only in the private server `.env`; Compose also forwards optional
`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` and
`ELEVENLABS_DAILY_CHARACTER_LIMIT`. Leaving the key unset permits bundled audio and
already cached narration, while new provider generation is unavailable. No provider
credential belongs in repository variables, source files or screenshots.

The GitHub workflow enforces `DEPLOY_REQUIRE_ROOTLESS=true` and
`DEPLOY_REQUIRE_PUBLIC_HEALTH=true`; repository variables cannot turn these off.
Those names are environment settings for portable/manual script use. The server
also needs `curl` and its system CA certificates for the HTTPS check.

## First release

1. Confirm the destination GitHub organization/repository and permissions for
   Actions and Packages. Image names follow the current repository owner; the
   pipeline does not transfer repository ownership.
2. Confirm the VPS is `linux/amd64`, has Compose 2.17 or later, and has sufficient
   disk and memory. Verify the rootless service persists after logout/reboot and
   that the supplied socket belongs to the deployment user's daemon.
3. Verify SSH access, both fingerprint pins, rootless Docker access and the
   persistent data/backup locations using the approved credentials.
4. Complete the domain, DNS and Nginx HTTPS configuration. Nginx should proxy to
   `http://127.0.0.1:3001`, permit 13 MB request bodies (`client_max_body_size 13m`),
   and forward the original host and HTTPS scheme. Retain the existing server's
   other virtual hosts and TLS management.
5. Agree whether the new site starts empty or receives approved existing data.
   Confirm the backup destination, off-site copy and retention policy. The
   current script keeps 14 local pre-deployment database/media backups; this is a
   technical default, not an agreed client retention policy.
6. Confirm the initial administrator's email and optional release approver. The
   administrator registers, then the server operator uses the documented
   `admin:grant` command for that account.
7. Set `DEPLOY_ENABLED=true` only after those checks. A passing default-branch
   release then builds/publishes the commit-specific GHCR image and deploys it.
   An older commit is skipped; inability to verify the newest commit is a failure.

The image receives both container health checks and an HTTPS health check through
the public origin. The public URL defaults to `${PUBLIC_ORIGIN}/api/health`;
`PUBLIC_HEALTH_URL` may specify another HTTPS endpoint. The client's domain and
certificate must therefore work before enabling the first deployment.

After deployment, check the real sign-in and role flows externally. Run a
controlled rollback exercise and a separate backup/restore exercise after
agreeing a suitable window. A failed deployment starts the previous image where
one exists. **Image rollback does not restore the database or uploaded files.**
The first deployment has no previous image; data restoration is a separate,
explicit operation using the saved backup.

For manual administration as `deployer`, select the same daemon before invoking
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
