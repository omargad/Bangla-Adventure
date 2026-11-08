# If the server's address or host key changes

This runbook is for the repository owner and the client's server administrator
(Faysal). It covers what to change in GitHub, and what to check on the server,
when the client's VPS comes back with a new address, comes back rebuilt, or does
not come back.

**Where things stand (8 November 2026).** The VPS has been unreachable since
7 November 2026: its provider withdrew the server's whole address block from
internet routing. Production was never deployed there, because it waits for the
client's domain. Only the private staging copy ran on the server, and it held
test data only. The public demonstration on Railway
(`bangla-adventure.up.railway.app`) is a separate host and keeps running.

Three things identify the server to the GitHub workflows, and each case below
changes a different set of them:

| What | Where it is kept | Changes in |
| --- | --- | --- |
| The server's address | The `DEPLOY_HOST` secret, in both the `production` and `production-status` environments | Cases A and B (B only if the address also changes) |
| The server's host-key line | The `DEPLOY_KNOWN_HOSTS` variable, in both the `production` and `production-status` environments | Cases A and B |
| The server's host-key fingerprint | Written into five workflows and scripts; the repository variable `DEPLOY_HOST_FINGERPRINT` overrides it in the other three (see [The fingerprint pins](#the-fingerprint-pins)) | Case B only |

The deployment account name (`DEPLOY_USER` secret), the deploy key
(`DEPLOY_SSH_KEY` secret, pinned by `DEPLOY_KEY_FINGERPRINT`), the account's
UID `1002` and the folder `/opt/bangla-adventures` stay the same in every case
unless the administrator says otherwise.

**Never write the server's address or the deployment account's name into the
repository**, an issue, a pull request, a commit message or a public chat. They
go only into the GitHub secrets named here. The repository is public. In this
document `SERVER_ADDRESS` stands for the address and `ACCOUNT` for the account
name.

## How to tell which case you are in

### What the administrator tells us

Ask the administrator for these four answers, sent privately (not in a GitHub
issue):

1. **Is it the same machine, with its disk intact?** Or was it reinstalled,
   rebuilt from an image or replaced?
2. **The new address**, if it changed.
3. **The server's ED25519 host-key fingerprint**, read on the server itself
   (from the provider's web console if SSH is not reachable yet):

   ```sh
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

   It prints a line such as `256 SHA256:... root@HOSTNAME (ED25519)`. The part
   starting `SHA256:` is the fingerprint. It is not secret. Ask for the whole
   public key line too (`cat /etc/ssh/ssh_host_ed25519_key.pub`); it is not
   secret either.
4. **Whether the provider will restore the address block at all**, or the
   server is being given up.

Then:

| The administrator says | And the fingerprint is | You are in |
| --- | --- | --- |
| Same machine, new address | `SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8` (the pinned one) | [Case A](#case-a-same-server-new-address) |
| Same machine, new address | Anything else | Stop. A machine that was not rebuilt keeps its host key. Ask the administrator to check again before changing anything |
| Reinstalled, rebuilt or a new machine | Anything else | [Case B](#case-b-rebuilt-or-new-server) |
| The server is gone, or the provider will not restore it | Not applicable | [Case C](#case-c-the-server-is-gone-for-good) |
| Same machine, same address, it is simply reachable again | The pinned one | Nothing to change: run [the checks](#run-the-checks) |

### What the SSH preflight says

The **VPS SSH preflight** workflow is the quickest test from GitHub. It changes
nothing on the server. Run it as in step 1 of [Run the checks](#run-the-checks)
and open the `ssh-preflight` job's **Verify pinned SSH access and rootless
Docker** step. GitHub shows the address and account as `***` in the log.

A successful run ends with
`preflight: read-only SSH checks passed; no application deployment was performed.`
Otherwise the log ends with one of these:

| Message in the log | What it means | Which case |
| --- | --- | --- |
| `ssh: connect to host *** port 22: Connection timed out` (or `No route to host`, `Network is unreachable`) | Nothing answered at the address in `DEPLOY_HOST` | The outage is not over, or `DEPLOY_HOST` still holds the old address: get the new one from the administrator ([Case A](#case-a-same-server-new-address)) |
| `ssh: connect to host *** port 22: Connection refused` | A machine answered, but SSH is not accepting connections | The administrator checks the SSH service and firewall on the server |
| `preflight: The pinned known_hosts entry does not cover the deployment server on port 22.` | `DEPLOY_HOST` was changed, but `DEPLOY_KNOWN_HOSTS` still holds the line for the old address. The check stops before contacting the server | [Case A](#case-a-same-server-new-address), steps 2, 5 and 6 |
| `preflight: DEPLOY_KNOWN_HOSTS contains a host key that does not match the supplied server fingerprint.` | The saved line holds a host key other than the pinned one. The check stops before contacting the server | A wrong line was pasted, or the server was rebuilt and the code still pins the old key ([Case B](#case-b-rebuilt-or-new-server)) |
| `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` followed by `Host key verification failed.` | The machine at that address showed a different host key from the saved line | The server was rebuilt, or the address now belongs to another machine. Change nothing until the administrator confirms the fingerprint; then [Case B](#case-b-rebuilt-or-new-server) |
| `***@***: Permission denied (publickey).` | The host key matched, so this is the right server, but the account refused the deploy key | The account is missing or was recreated, or its `authorized_keys` lacks the deploy key ([Case B](#what-the-administrator-recreates), steps 1 and 5) |
| `preflight: The deployment user does not have the expected UID 1002.` | The account exists but with another UID | [If the UID cannot be 1002](#if-the-uid-cannot-be-1002) |
| `preflight: The deployment directory is missing.` or `... is not writable by the deployment user.` | `/opt/bangla-adventures` is missing or has the wrong owner | [Case B](#what-the-administrator-recreates), step 4 |
| `preflight: The prepared Docker daemon is not accessible.`, `... does not report rootless mode.` or `Docker Compose is not available.` | Rootless Docker is not running for the account | [Case B](#what-the-administrator-recreates), steps 2 and 3 |

The private staging and private acceptance workflows withhold SSH's own
messages (their logs say only "Read-only SSH inventory failed" or "Read-only
inventory refused"), so always run the preflight first: it is the one that
shows why.

## Case A: same server, new address

The host key is unchanged, so its fingerprint pin stays as it is. Only the
address and the host-key line change. The line changes too because it names
one address, plainly or in the hashed form recommended in
[Server address secrets](VPS_DEPLOYMENT.md#server-address-secrets), so it does
not cover the new one.

1. **Get the answers** in [What the administrator tells us](#what-the-administrator-tells-us).
   The fingerprint must be `SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8`.
   If it is not, stop: this is not case A.
2. **Build the new `DEPLOY_KNOWN_HOSTS` line** on your own computer, as in
   [Building the host-key line](#building-the-host-key-line). Keep the file
   `server.keys` open; its one line is the new value.
3. **Update `DEPLOY_HOST` in `production`.** In GitHub, open **Settings >
   Environments > production**. Under **Environment secrets**, select the
   pencil (edit) button next to `DEPLOY_HOST`, enter the new address alone (no
   spaces, no `ssh://`, no account name) and choose **Update secret**.
4. **Update `DEPLOY_HOST` in `production-status`.** Open **Settings >
   Environments > production-status** and do the same, with exactly the same
   value. GitHub never shows a secret again, so type it carefully.
5. **Update `DEPLOY_KNOWN_HOSTS` in `production`.** Back on **Settings >
   Environments > production**, under **Environment variables**, select the
   pencil button next to `DEPLOY_KNOWN_HOSTS`, replace the whole value with the
   line from `server.keys` and choose **Update variable**. One line only: the
   private staging and acceptance workflows accept exactly one ED25519 line.
6. **Update `DEPLOY_KNOWN_HOSTS` in `production-status`** the same way, with
   the same line.
7. **Check the names.** Each environment page must still list `DEPLOY_HOST`,
   `DEPLOY_USER` and `DEPLOY_KNOWN_HOSTS` under those exact names (`production`
   also lists `DEPLOY_SSH_KEY`; `production-status` lists `STATUS_SSH_KEY`).
   With the GitHub CLI: `gh secret list --env production`,
   `gh variable list --env production`, and the same with
   `--env production-status`. Leave the repository variable
   `DEPLOY_HOST_FINGERPRINT` unset in this case.
8. **Run the checks** in [Run the checks](#run-the-checks). The existing
   private stage and its data are kept: the private staging workflow backs up
   the stage it finds and starts it again on the same data.
9. Delete `server.keys` (and `server.keys.old`, if you made one) from your
   computer.

The daily **VPS production status** workflow is skipped until production is
switched on (`DEPLOY_ENABLED=true`), so steps 4 and 6 are not tested until go-live.
They are needed then; that is why both environments are updated now.

### Building the host-key line

The value of `DEPLOY_KNOWN_HOSTS` is one line: the address (hashed, so the line
does not reveal it), the key type `ssh-ed25519` and the server's public host
key. Make it in either of two ways. The commands work in Git Bash, WSL, macOS
or Linux; PowerShell versions follow each block.

**From the key the administrator sent (preferred).** The administrator's line
looks like `ssh-ed25519 AAAAC3Nza... root@HOSTNAME`. Write a file `server.keys`
holding one line: the new address, a space, then the first two parts of that
line (`ssh-ed25519` and the long `AAAA...` part), leaving out `root@HOSTNAME`.
Then hash it and show its fingerprint:

```sh
printf '%s\n' 'SERVER_ADDRESS ssh-ed25519 AAAAC3Nza...' > server.keys
ssh-keygen -H -f server.keys
rm server.keys.old
ssh-keygen -lf server.keys
```

```powershell
Set-Content -Encoding ascii -Path server.keys -Value 'SERVER_ADDRESS ssh-ed25519 AAAAC3Nza...'
ssh-keygen -H -f server.keys
Remove-Item server.keys.old
ssh-keygen -lf server.keys
```

`ssh-keygen -H` replaces the address with a hash and keeps the original in
`server.keys.old`, which still shows the address, so delete it. The last
command must print the fingerprint the administrator read on the server.

**By scanning from your computer, then comparing.** Once the server answers on
its new address:

```sh
ssh-keyscan -t ed25519 -H -p 22 SERVER_ADDRESS > server.keys
ssh-keygen -lf server.keys
```

```powershell
ssh-keyscan -t ed25519 -H -p 22 SERVER_ADDRESS | Out-File -Encoding ascii server.keys
ssh-keygen -lf server.keys
```

(In Windows PowerShell 5.1, a plain `>` writes a file `ssh-keygen` cannot read,
hence `Out-File -Encoding ascii`; see [DEPLOYMENT.md](DEPLOYMENT.md), step 5.)

**Never trust a scanned key on its own.** Scanning asks whatever machine
answers at that address for its key, and a machine that is not ours answers
with its own. Use the line only if the fingerprint `ssh-keygen -lf` prints is
exactly the one the administrator read on the server and sent you separately.
In case A it must also be the pinned
`SHA256:79xe+ubCodL2ACAHPNloo7I/K6mvngU88vEiFoEeWL8`. If anything differs,
stop and ask the administrator.

Either way, `cat server.keys` (PowerShell: `Get-Content server.keys`) shows the
one line, starting `|1|`, to paste into `DEPLOY_KNOWN_HOSTS`.

## Case B: rebuilt or new server

A reinstalled or new machine has a new host key, so it needs everything in
case A **and** a new fingerprint pin, and the administrator must prepare the
server again exactly as before. Nothing of production existed on the old
server, so there is no production data, configuration or backup to restore.
The old private stage is gone and is recreated from scratch; it held test data
only.

### What the administrator recreates

On the new server, as root (or with `sudo`):

1. **The deployment account, with UID `1002`.** Check that UID 1002 is free
   (`getent passwd 1002` prints nothing), then create the account with the same
   name as before:

   ```sh
   sudo useradd --create-home --uid 1002 --shell /bin/bash ACCOUNT
   ```

   If the account must have another name, the owner changes the `DEPLOY_USER`
   secret in both environments (as in case A, steps 3 and 4, for
   `DEPLOY_USER`). If the UID cannot be 1002, see
   [If the UID cannot be 1002](#if-the-uid-cannot-be-1002) first.
2. **Rootless Docker for that account, with lingering**, so the account's
   Docker daemon and timers keep running while nobody is logged in and after
   a restart. Follow [Docker's rootless guide](https://docs.docker.com/engine/security/rootless/)
   for Ubuntu (packages `uidmap` and
   `dbus-user-session`, the account's ranges in `/etc/subuid` and
   `/etc/subgid`, then `dockerd-rootless-setuptool.sh install` run as the
   account), and enable lingering:

   ```sh
   sudo loginctl enable-linger ACCOUNT
   ```

   Docker Compose must be version 2.17 or later, and the server
   `linux/amd64`, as before.
3. **The socket and context the workflows expect.** As the account (signed in
   directly, for example over SSH, not through `sudo -u`):

   ```sh
   docker --host unix:///run/user/1002/docker.sock info --format '{{json .SecurityOptions}}'   # must include name=rootless
   docker context inspect rootless --format '{{.Endpoints.docker.Host}}'                      # must print unix:///run/user/1002/docker.sock
   docker compose version --short                                                              # 2.17 or later
   ls /var/lib/systemd/linger/                                                                 # must list ACCOUNT
   ```

   The setup tool normally creates the `rootless` context; if it is missing,
   `docker context create rootless --docker host=unix:///run/user/1002/docker.sock`
   creates it. The private staging and acceptance workflows require both the
   socket `/run/user/1002/docker.sock` and the context named `rootless`. The
   repository variables `DEPLOY_DOCKER_HOST` and `DEPLOY_DOCKER_CONTEXT` do not
   help if the socket is elsewhere: only the CI deployment reads them, the
   production operations refuse any other socket and any context, and the
   preflights and private staging have the socket path written into them.
   Leave both variables unset.
4. **The deployment folder.** A real folder (not a link), owned by the account
   (or by root), not writable by others, and writable by the account:

   ```sh
   sudo install -d -o ACCOUNT -g ACCOUNT -m 0750 /opt/bangla-adventures
   ```

   Its filesystem needs at least 5 GiB free and the server at least 1 GiB of
   available memory, or private staging refuses to start.
5. **The deploy key.** Put the same deploy public key line that was installed
   before (the one in the administrator's 5 November 2026 server handover
   email) into `~ACCOUNT/.ssh/authorized_keys`, with the folder at mode `0700`
   and the file at `0600`, both owned by the account. Check it:

   ```sh
   sudo ssh-keygen -lf ~ACCOUNT/.ssh/authorized_keys
   ```

   One line must show `SHA256:y1+C6cvcfpJFmO8pfjyMSFERpd5BtcQyDf5SptZXVlQ`.
   That is the deploy key's pinned fingerprint: the default of
   `DEPLOY_KEY_FINGERPRINT` in every workflow, recorded in
   [Settings to complete](VPS_DEPLOYMENT.md#settings-to-complete). The owner
   can also print the public line from the private key file on their own
   computer with `ssh-keygen -y -f bangla_deploy`. Keep this key: a new deploy
   key would need the same code change as a new host key, because the key
   fingerprint is written into the same five files.
6. **SSH, ports and outbound access.** SSH on port 22 with key sign-in,
   reachable from GitHub's hosted runners as before. Nothing else on the server
   may use `127.0.0.1:3001`: production publishes the app there, on loopback
   only. The server must reach `ghcr.io` over HTTPS to pull the image. It also
   needs `python3`, `curl` with the system CA certificates, `tar` and `ss`,
   which Ubuntu 24.04 includes.
7. **Nginx.** Keep Nginx (1.24) and certbot for the server's other sites,
   holding ports 80 and 443. The Bangla Adventures site file and its
   certificate are added only at go-live, once the domain is confirmed
   ([Going live](VPS_DEPLOYMENT.md#going-live), step 3), so there is nothing to
   add for it now.
8. **Send the owner** the new address (if it changed), the new ED25519 host-key
   fingerprint and public key line, the account name if it changed, and the
   output of the checks in steps 3 and 5.

Two things are not recreated by hand:

- **The status key** is added to `authorized_keys` by the **VPS production
  operations** `install` at go-live
  ([Going live](VPS_DEPLOYMENT.md#going-live), step 9). Do not add it now.
- **The private stage** is recreated by the **VPS private staging** workflow,
  with a fresh database (15 pending topics, 18 pending lessons, no accounts),
  and the **VPS private acceptance** workflow installs its backup and monitor
  jobs again. Nothing is copied from the old server.

### The fingerprint pins

The new host key's fingerprint must reach every workflow that connects. Today
they get it in two different ways:

| Workflow | Script that connects | Where the host fingerprint comes from |
| --- | --- | --- |
| CI (`deploy` job) | `scripts/deploy.sh` | Repository variable `DEPLOY_HOST_FINGERPRINT`, else the default written in `.github/workflows/ci.yml` |
| VPS production operations | `scripts/production-ops-controller.sh` | Repository variable `DEPLOY_HOST_FINGERPRINT`, else the default in `.github/workflows/vps-production-ops.yml` |
| VPS production status | `scripts/production-ops-controller.sh` | Repository variable `DEPLOY_HOST_FINGERPRINT`, else the default in `.github/workflows/vps-production-status.yml` |
| VPS SSH preflight | The workflow itself | Written in `.github/workflows/vps-ssh-preflight.yml` (`host_pin`); the variable is not read |
| VPS image preflight | The workflow itself | Written in `.github/workflows/vps-image-preflight.yml` (`host_pin`); the variable is only reported, as `unexpected` when it differs from the old pin |
| VPS private staging | `scripts/private-staging.sh` | Written in the script (`host_pin`); the variable is not read |
| VPS private acceptance | `scripts/private-staging-acceptance.sh` | Written in the script (`host_pin`); the variable is not read |
| VPS off-site rehearsal | `scripts/private-staging-offsite-rehearsal.sh` | Written in the script (`host_pin`); the variable is not read |

So for a new host key:

1. **Set the repository variable.** Open **Settings > Secrets and variables >
   Actions**, the **Variables** tab, and choose **New repository variable**.
   Name: `DEPLOY_HOST_FINGERPRINT`. Value: the new fingerprint exactly as
   `ssh-keygen -lf` printed it, `SHA256:` followed by 43 characters. Choose
   **Add variable**. Keep it at repository level, not on an environment: the
   daily status check runs in `production-status` and would not see a
   `production` environment variable, and an environment variable of the same
   name would replace the repository one.
2. **Ask the developer to change the written-in pin** in the five files marked
   "Written in" above, in one reviewed change on `main`, before running the
   preflight, private staging or private acceptance. Until then those
   workflows refuse the new line with "DEPLOY_KNOWN_HOSTS contains a host key
   that does not match the supplied server fingerprint" or "Server key
   fingerprint does not match the verified VPS". The same change updates the
   old fingerprint where the tests and documents name it
   (`tests/private_staging_controller_test.py`,
   `tests/private_staging_acceptance_controller_test.py`,
   `tests/private_staging_offsite_rehearsal_test.py`,
   [VPS deployment](VPS_DEPLOYMENT.md), [Private staging](PRIVATE_STAGING.md),
   `deploy/vps.github-variables.env.example`, the defaults in the three
   workflows above that read the variable, the fallback defaults in
   `scripts/deploy.sh` and `scripts/production-ops-controller.sh`, and this
   document). The new value must be identical in the variable and in the code.

### Steps for the owner

1. **Wait for the administrator's message** (step 8 above).
2. **Check the host-key fingerprint.** Build the `DEPLOY_KNOWN_HOSTS` line as in
   [Building the host-key line](#building-the-host-key-line): it must show the
   new fingerprint the administrator sent. The pinned old fingerprint no
   longer applies.
3. **Update `DEPLOY_HOST`** in `production` and `production-status` if the
   address changed, and `DEPLOY_USER` in both if the account name changed
   (case A, steps 3 and 4).
4. **Update `DEPLOY_KNOWN_HOSTS`** in `production` and `production-status`
   (case A, steps 5 and 6).
5. **Set `DEPLOY_HOST_FINGERPRINT`** and have the pin changed in the code
   ([The fingerprint pins](#the-fingerprint-pins)).
6. **Run the checks** in [Run the checks](#run-the-checks). Private staging
   starts a new, empty stage. Afterwards, download the new run's
   `private-staging-access` artifact for the PowerShell tunnel in
   [Private staging](PRIVATE_STAGING.md#open-staging-from-windows-powershell):
   the old artifact's `staging_known_hosts` holds the old key.

### If the UID cannot be 1002

The simplest course by far is to give the account UID 1002 again. The UID is
written into these files, and every one would need a reviewed code change
(with its tests) before the workflows could use another UID. This list is for
that change; nothing has been changed yet.

- Workflows: `.github/workflows/vps-ssh-preflight.yml` and
  `.github/workflows/vps-image-preflight.yml` (UID check and socket path);
  `.github/workflows/ci.yml`, `.github/workflows/vps-production-ops.yml` and
  `.github/workflows/vps-production-status.yml` (default socket path).
- Private staging scripts, which check the UID, the owner of every staging file
  and the socket path: `scripts/private-staging.sh`,
  `scripts/private-staging-remote.sh`, `scripts/private-staging-acceptance.sh`,
  `scripts/private-staging-qa.sh`, `scripts/private-staging-rollback.sh`,
  `scripts/private-staging-drill.sh`,
  `scripts/private-staging-offsite-rehearsal.sh`,
  `scripts/private-staging-ops.py` and `scripts/private-staging-ops-install.py`
  (`scripts/private-staging-offsite-rehearsal.py` names it only in a comment).
- Production operations: `scripts/production-ops-controller.sh` (requires
  `DEPLOY_DOCKER_HOST` to be the UID 1002 socket, checks the UID and folder
  owners on the server, and sets `XDG_RUNTIME_DIR=/run/user/1002`),
  `scripts/production-ops.py` (`OWNER = 1002` and the socket path), and the
  units `deploy/production-ops/ba-production-backup.service`,
  `ba-production-monitor.service` and `ba-production-offsite.service`
  (`DOCKER_HOST`).
- Settings template: `deploy/vps.github-variables.env.example`
  (`DEPLOY_DOCKER_HOST`).
- Tests that expect UID 1002 or its socket: `tests/private_staging_ops_test.py`,
  `tests/production_ops_test.py`, `tests/private_staging_controller_test.py`,
  `tests/private_staging_acceptance_controller_test.py`,
  `tests/private_staging_offsite_rehearsal_test.py`,
  `tests/private-staging-drill.test.mjs`, `tests/private-staging-qa.test.mjs`,
  `tests/private-staging-remote.test.mjs`,
  `tests/private-staging-rollback.test.mjs` and `tests/vps-staging.test.mjs`.
- Documents naming UID 1002 or its socket: [VPS deployment](VPS_DEPLOYMENT.md),
  [Deployment guide](DEPLOYMENT.md), [Private staging](PRIVATE_STAGING.md),
  [Private staging operations](PRIVATE_STAGING_OPERATIONS.md),
  [Private staging rollback](PRIVATE_STAGING_ROLLBACK.md) and
  [Production operations](PRODUCTION_OPERATIONS.md).

`scripts/deploy.sh` and `scripts/deploy-remote.sh` do not assume the UID: they
use whichever socket `DEPLOY_DOCKER_HOST` names. `scripts/production-ops-install.py`
takes the UID from `scripts/production-ops.py`, so it follows that change.

## Case C: the server is gone for good

If the provider will not restore the address block, or the client gives the
server up, follow the fallback hosting plan in
[Hosting fallback](HOSTING_FALLBACK.md). Nothing of production is lost, because
production never ran on this server, and the private stage held test data only.
Until a decision is made, leave `DEPLOY_ENABLED` unset or `false` and the
server settings in GitHub as they are; the Railway demonstration keeps running.

## Run the checks

Run these in order, on `main`, from the **Actions** tab. Each one's server job
uses the `production` environment, which has required reviewers: when the run
shows **Review deployments**, a reviewer opens it, ticks `production` and
chooses **Approve and deploy**. Keep the repository variable `DEPLOY_ENABLED`
unset or `false`; all three refuse to contact the server otherwise.

1. **VPS SSH preflight.** Choose **VPS SSH preflight** in the list of
   workflows, then **Run workflow**, leave **Use workflow from** on
   `Branch: main` and choose **Run workflow**. It has no inputs and changes
   nothing on the server. It must end with
   `preflight: read-only SSH checks passed; no application deployment was performed.`
   If it does not, see [What the SSH preflight says](#what-the-ssh-preflight-says)
   and go no further.
2. **VPS private staging.** Choose **VPS private staging > Run workflow** on
   `main` and tick **Start only the pinned clean private stage without
   publishing VPS ports** (the input `confirm_private_staging`). Unticked,
   nothing runs. It must end with `private staging: verified pinned image and
   clean private stage through SSH; ...`, and the run keeps the
   `private-staging-access` artifact for seven days.
3. **VPS private acceptance.** Choose **VPS private acceptance > Run workflow**
   on `main` and tick **Exercise only private operational checks and
   disposable rollback/classroom QA** (the input `confirm_acceptance`). It needs
   the healthy stage from step 2. It must end with
   `Private acceptance passed: operational backup/monitor, isolated failed-release rollback and four-role QA; ...`.

Optionally, if the off-site backup rehearsal is still part of the client's
review, run **VPS off-site rehearsal** afterwards, ticking its one checkbox
(`confirm_offsite_rehearsal`); see
[Off-site rehearsal](PRODUCTION_OPERATIONS.md#off-site-rehearsal).

## Related documents

- [VPS deployment](VPS_DEPLOYMENT.md): the server address secrets, the
  settings and the go-live steps
- [Deployment guide](DEPLOYMENT.md): recording a host key (step 5) and the
  GitHub settings table
- [Private staging](PRIVATE_STAGING.md) and
  [Production operations](PRODUCTION_OPERATIONS.md)
- [Hosting fallback](HOSTING_FALLBACK.md)
