# Private VPS staging before the public domain is ready

This is a separate staging deployment. The public production workflow keeps its
HTTPS health requirement and disabled deployment gate. No Nginx, firewall,
production settings file or existing database is changed by staging.

## Deployment contract

| Setting | Value |
| --- | --- |
| Server identity | `$DEPLOY_USER@$DEPLOY_HOST`, SSH 22, UID 1002 |
| Docker | Rootless daemon at `unix:///run/user/1002/docker.sock` |
| Directory | `/opt/bangla-adventures/private-staging`, owner 1002, mode 0700 |
| Project | `bangla-adventures-staging` |
| Data volume | `bangla-adventures-staging_bangla-data` |
| Runtime | One application plus a private Unix-socket transport proxy |
| Published VPS TCP ports | None |
| Socket | `/opt/bangla-adventures/private-staging/runtime/http.sock` |
| Browser origin through SSH | `http://127.0.0.1:3001` |
| Image | `ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2` |
| Expected image revision | `95b6308ac7ad3d5b6bb2d951df9d65a23ff77107` |

`DEPLOY_USER` and `DEPLOY_HOST` are the repository variables holding the SSH
account and address from the server handover email; see
[Repository variables](VPS_DEPLOYMENT.md#repository-variables). The pinned host
key, not the address, establishes the server's identity.

The image is the tested main release. The runner verifies the deployment key,
server host key, server identity, rootless engine, available capacity and existing
resource ownership before uploading a payload. Both the source Compose model and
the actual created containers must have no published ports or production-data
mounts. The parent directory remains private even though the socket runtime
directory permits the container's mapped user to create its socket.

The new database starts with 15 pending topics and 18 pending lessons. There are
no users, default Admin, publication decisions or migrated demo records. Content,
recording and video reviews are actual separate Admin tasks.

## Run and validate

The **VPS private staging** workflow runs on `main` only, through either its
explicit manual confirmation or a main commit carrying `[private-staging-start]`
that changes its workflow file. Its repository gate and no-secret validation job
must pass before the job loads the production environment's existing SSH secret.
The production deployment gate remains disabled throughout.

Checks cover container health, SQLite integrity/foreign keys, media/database write
probes, all 33 pending items, zero accounts, container replacement persistence and a backup/restore
drill using an owned disposable volume. Upgrade backups and configuration/image
rollback are limited to staging; they do not restore database contents implicitly.

Actual browser authentication is tested only on a separately marked disposable QA
instance. Random fictional parent/student credentials are not logged or saved.
The browser verifies the instance's HTTP marker and independent container/volume
attestation before creating accounts. Its volume, network and containers are
removed afterward, and actual staging is checked again for zero users.

Successful-run evidence contains sanitized results, fictional QA screenshots and
`staging_known_hosts`, which contains only the verified public host key, filed
under the fixed name `bangla-adventures-vps` rather than the server address.
It never contains the private deployment key, registry token, passwords, session
values or private backups. A workflow attempt is not deployment success: inspect
the workflow's actual result and evidence before claiming staging is ready.

## Open staging from Windows PowerShell

Download the successful workflow's `private-staging-access` artifact and extract
it. Use its verified `staging_known_hosts` file without altering the key; the
`HostKeyAlias` option below makes SSH look the key up under its fixed name. The
private key remains the existing `bangla_deploy` file on your own laptop. Fill in
the account and address from the server handover email (the `DEPLOY_USER` and
`DEPLOY_HOST` repository variables).

```powershell
$deployUser = "<from the handover email>"
$deployHost = "<from the handover email>"
$stagingHosts = "C:\path\to\extracted\staging_known_hosts"
ssh -F NUL -i "$env:USERPROFILE\bangla_deploy" -p 22 `
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes `
  -o GlobalKnownHostsFile=NUL -o "UserKnownHostsFile=$stagingHosts" `
  -o HostKeyAlias=bangla-adventures-vps `
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 `
  -N -L "127.0.0.1:3001:/opt/bangla-adventures/private-staging/runtime/http.sock" `
  "$deployUser@$deployHost"
```

Leave that terminal open and visit `http://127.0.0.1:3001` in your browser.
Use that exact host and port; `localhost` or a different local port has a different
origin. Close the SSH connection when finished. If local 3001 is occupied, resolve
that local conflict rather than changing the origin or weakening cookie checks.

The server host key must match
`SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8`. Do not accept a changed key
without verifying it with Faysal. OpenSSH supports forwarding a local TCP port to
a remote Unix socket over its secure channel:
[OpenSSH forwarding reference](https://man.openbsd.org/ssh).

## Public production and handover

Still required: final domain/DNS/Nginx/HTTPS, organisation/registry permissions,
the designated first Admin, approved production-data choice and offsite backup
destination/retention/owner. Private staging does not choose these for the client.
New ElevenLabs generation additionally needs a privately configured client key.

No default administrator is created. Once the owner is designated, registration
and an explicit operator Admin grant can be performed in the intended environment.
Do not copy staging identities, approval fixtures or data into production.
