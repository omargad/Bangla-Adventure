# Hosting fallback plan

This plan is for the client (Dr Tanjila Kanij and Faysal Alam) and the repository
owner. It says what to do if the client's VPS does not come back: what the application
needs from a host, what a replacement server costs, which one we recommend, and exactly
how to move the existing deployment pipeline to it. Prices were read on
**8 November 2026** from the official pages listed under [Sources](#sources); they
change, so check them again before signing up.

## Where things stand

- The client's VPS has been unreachable since 7 November 2026. Its provider withdrew the
  server's whole block of internet addresses from routing, so nothing reaches it, and
  nothing we can do from GitHub changes that.
- **No production data is at risk.** Production was never deployed there; it is waiting
  for the client's domain. Only the private staging copy ran on that server, and no real
  users' data exists yet.
- The Railway demo at <https://bangla-adventure.up.railway.app> still runs. It is a
  demonstration with its own made-up data, not production
  ([Keep the Railway demo as a stop-gap](#keep-the-railway-demo-as-a-stop-gap)).
- Nothing in this plan needs doing while there is a reasonable chance the server returns.
  We suggest the client and owner agree a date (for example one week after the outage
  began). If the server is still unreachable then, or its provider says the addresses
  will not come back, follow [Moving to a new server](#moving-to-a-new-server).

**In short:** a small Sydney server from DigitalOcean (1 vCPU, 2 GB memory, 50 GB disk,
daily backups) costs about **US$15.60 a month**. Moving to it takes about **half a day of
hands-on work**, spread over a day or two by waiting for DNS and approvals. The
pipeline, the image, the server settings, the Nginx site, the backups and the daily status
check all carry over; only the server's address, account, keys and host-key pin change in
GitHub. The real question for the client is **who administers the new server**
([Trade-off against the client's own server](#trade-off-against-the-clients-own-server)).

## What the application needs

These come from the repository, not from estimates of the provider's plans.

| Need | What the repository requires | Where it is set |
| --- | --- | --- |
| Processor | x86-64 (amd64): the pipeline publishes `linux/amd64` images only | [Automatic deployment](DEPLOYMENT.md#automatic-deployment), "On the server, once" |
| Memory | No limit is set in `compose.yaml`. The Railway demo, running the same application, peaked at **0.30 GB** and averaged 0.05 GB over the 7 days to 8 November 2026. The image is built in GitHub Actions, not on the server, so **2 GB** leaves ample room for Docker, Nginx and the nightly backup | `compose.yaml`, `Dockerfile` |
| Processor share | The same 7 days peaked at 0.09 of one vCPU. **1 vCPU** is enough | |
| Disk | **25 GB at least; 50 GB recommended.** The operating system and two kept images take a few GB. The data volume and the 14 local backup archives grow with uploaded recordings: about 0.25 to 0.4 GB a backup for a typical school, about 1 GB with heavy use ([size estimates](BACKUP_DESTINATIONS.md#how-much-space-and-what-it-costs)), so 14 archives need 3.5 to 14 GB. The 5-minute monitor raises `disk-low` when free space runs short | [Production operations](PRODUCTION_OPERATIONS.md#the-monitor) |
| One running copy | SQLite, uploaded media on local disk and in-memory sign-in limits: exactly **one** instance, never two | [Prerequisites](DEPLOYMENT.md#prerequisites) |
| Persistent local disk | The Compose volume `bangla-data` at `/app/.data`, on a local (block) disk, never a network share | [Other container hosts](DEPLOYMENT.md#other-container-hosts) |
| Docker | Docker Engine with Compose 2.17 or newer, rootless for the deployment account (the GitHub deploy refuses a rootful daemon) | [VPS deployment](VPS_DEPLOYMENT.md#settings-to-complete) |
| HTTPS | A reverse proxy in front of `127.0.0.1:3001` with a real certificate. Sign-in cookies are Secure, so sign-in over plain `http://` works only at `localhost` | [`deploy/nginx/bangla-adventures.conf.example`](../deploy/nginx/bangla-adventures.conf.example) |
| Uploads | The proxy must let **13 MB** requests through (lesson audio can be 12 MB) and allow a read timeout above narration's 60 seconds | the same Nginx site file |
| Backups | The app's own nightly backup (16:30 UTC), 14 kept locally, plus an encrypted off-site copy once the client chooses a destination | [Production operations](PRODUCTION_OPERATIONS.md), [Choosing the off-site backup destination](BACKUP_DESTINATIONS.md) |
| Other software | `curl`, system CA certificates and Python 3 on the server (all in Ubuntu 24.04's standard image); `systemd` user services with lingering for the timers | [Switching it on](PRODUCTION_OPERATIONS.md#switching-it-on) |

## Options compared

All prices are monthly, **as of 8 November 2026**, for the smallest plan meeting the
needs above in Australia, or in Singapore where a provider has nothing in Australia. They
exclude any GST or VAT the provider adds. US dollars unless marked; Hetzner bills in euros
and BinaryLane in Australian dollars.

| Provider | Plan (vCPU / memory / disk, transfer) | Region | Price a month | Backups add-on | Docker and rootless Docker | Nonprofit credits |
| --- | --- | --- | --- | --- | --- | --- |
| **DigitalOcean** | Basic Droplet: 1 / 2 GiB / 50 GiB SSD, 2,000 GiB (2 vCPU / 2 GiB / 60 GiB: US$18) | Sydney (SYD1) or Singapore (SGP1) | **US$12** | Weekly: 20% of the server price (US$2.40); daily: 30% (US$3.60) | Plain Ubuntu 24.04 image; Docker's own packages and rootless set-up exactly as on the client's server | "DO for Nonprofits & Social Enterprises": a one-off US$2,500 credit for a year, announced in 2023; check it is still open |
| **Vultr** | Cloud Compute Regular: 1 / 2 GB / 55 GB SSD, 2 TB. High Performance (AMD): 1 / 2 GB / 50 GB NVMe, 3 TB, US$12 | Sydney, Melbourne or Singapore | **US$10** (Regular) | 20% of the server price (US$2 or US$2.40) | Same as DigitalOcean | None found: Vultr lists startup, open-source and free-tier programmes only |
| **Akamai (Linode)** | Shared Linode 2 GB: 1 / 2 GB / 50 GB, 2 TB | Sydney or Singapore (Melbourne has limited availability) | **US$12** | US$2.50 | Same | None found: a US$100 credit for new accounts only |
| **AWS Lightsail** | 2 GB bundle: 2 burstable vCPU / 2 GB / 60 GB SSD, 3 TB (halved to 1.5 TB in Sydney) | Sydney or Singapore | **US$12** | Automatic snapshots: US$0.05 per GB a month | Same (Ubuntu 24.04 image) | AWS Nonprofit Credit Program, up to US$5,000 through TechSoup; schools and other educational institutions are excluded |
| **Hetzner** | CPX12: 1 AMD / 2 GB / 40 GB NVMe, 0.5 TB | Singapore (no Australian location) | **€15.99** | Daily, 7 kept, at 20% of the server price (the page lists backups from €1.198 against its €5.99 entry server), so about €3.20 | Same | None found |
| **BinaryLane** (Australian) | Standard: 1 / 2 GB / 40 GB NVMe, 2,000 GB | Sydney, Melbourne, Brisbane, Adelaide, Perth or Singapore | **A$9.80** | A$0.05 per GB per backup kept | Same | None found |
| **Railway** (managed, the demo's host) | Hobby plan, paid by use: no server to run | Singapore (Asia Southeast); no Australian region | **US$5**, which includes US$5 of usage | Volume backups, billed as volume storage | Railway runs the app itself; no server, SSH or Docker to administer | None found |

Notes on the table:

- **Prices by region.** DigitalOcean's pricing page shows one price list, with no regional
  prices. Vultr says some locations may be priced differently and shows the current price
  in its control panel. Akamai says some regions are priced differently and lists Jakarta separately;
  Sydney, Melbourne and Singapore are not listed separately. Lightsail charges the same
  price in Sydney but halves the transfer allowance. Hetzner charges more in Singapore than
  in Europe (€11.99 there for the same server) and includes only 0.5 TB of transfer.
- **Availability.** DigitalOcean's availability page lists Basic Droplets as available in
  both SYD1 and SGP1. When Hetzner's page was read, every plan also showed "This product
  is currently unavailable", so check stock in its console first.
- **What the backups are.** Every provider's backup is a whole-disk image kept by the same
  provider. It is a quick way back from a broken upgrade, but not an off-site copy: if the
  provider or account is lost, so are its backups. The app's own consistent nightly archive
  sits on that disk and is included in each image. The off-site copy in
  [Choosing the off-site backup destination](BACKUP_DESTINATIONS.md) is still needed.
- **Docker.** All six VPS providers offer standard Ubuntu 24.04 virtual machines, so
  Docker's own `apt` packages, including `docker-ce-rootless-extras`, install the same way
  on each, and the rootless daemon works as it does on the client's server. Docker documents
  that the `apt` packages already include the AppArmor profile Ubuntu 24.04 needs for
  rootless mode. No provider needs anything special.
- **Nonprofit credits.** None of these programmes was applied for or confirmed for the
  client. AWS's excludes schools; whether the client counts as one is for the client to
  check. DigitalOcean's would cover the recommended server for its first year.

### Railway as a managed alternative

Railway runs the same application with no server to administer: it builds from GitHub,
provides HTTPS and the domain, and keeps a persistent volume. The demo already runs there.
What it would mean for production:

- **Current set-up** (read from the project on 8 November 2026): one service in the owner's
  personal Railway workspace, in Asia Southeast (Singapore), deploying `main` after the
  GitHub Actions checks pass, built with Railway's own builder rather than the repository's
  `Dockerfile`, with a 0.5 GB volume at `/app/.data`. Its limits (2 vCPU, 1 GB memory, a
  0.5 GB volume) are the Trial plan's. The Trial ends 30 days after sign-up or once its
  US$5 credit is used, and then becomes the Free plan: 1 vCPU, 0.5 GB memory, a 0.5 GB
  volume, no custom domain, US$1 of credit a month.
- **Usage pricing:** memory US$0.00000386 per GB-second (about US$10 per GB a month), CPU
  US$0.00000772 per vCPU-second (about US$20 per vCPU a month), volumes US$0.00000006 per
  GB-second (about US$0.16 per GB a month), outbound traffic US$0.05 per GB. At the demo's
  measured use, even 0.3 GB of memory all month plus a 1 GB volume comes to about US$3.20
  before a small amount of processor time, still inside the Hobby plan's included US$5.
- **Limits for production:** the Hobby plan allows volumes up to **5 GB** (Pro, US$20 a
  month including US$20 of usage, allows up to 1 TB), so heavy use of recordings would
  outgrow Hobby. Volume backups (daily kept 6 days, weekly kept 27, monthly kept 89) can be
  restored only into the same project, are lost if the volume is wiped, and Railway still
  calls them a newer feature. The repository's reviewer-approved deploy, nightly backup,
  monitor, off-site copy and daily status alert all work over SSH on a server and do not
  run on Railway, so an off-site copy there would need separate work. Data would sit in
  Singapore, not Australia.

Railway is the low-administration choice if nobody can look after a server. For a site
holding children's records and recordings, we prefer a server where the tested backup,
off-site copy and alerting already work.

## Recommendation

**DigitalOcean, Sydney (SYD1): a Basic Droplet with 1 vCPU, 2 GiB memory and 50 GiB disk,
with daily backups, for US$15.60 a month (US$12 plus US$3.60), plus any GST.**

Why this one:

- It meets every need above with room to spare, and 50 GiB holds even heavy use of
  recordings.
- Sydney keeps the children's records and recordings in Australia, which the client's
  privacy reviewers may prefer. Choose Singapore (SGP1) instead, at the same price, only if
  most learners are in Bangladesh.
- Daily backups at a fixed percentage, a plain Ubuntu image, team access to one account for
  the client and an administrator, and a nonprofit programme that, if still open and the
  client qualifies, would pay for the first year.
- Nothing in the pipeline is specific to it; any provider in the table can be used with the
  same steps.

**Runner-up: BinaryLane, Melbourne or Sydney, A$9.80 a month plus backups.** It is the
cheapest, Australian-owned and billed in Australian dollars, with Melbourne and Sydney
locations. Choose it if paying an Australian company in Australian dollars matters more
than a larger provider's tooling and nonprofit programme.

### Trade-off against the client's own server

The client's server costs nothing extra and Faysal already administers it: the operating
system, Nginx and certificates, its other sites, and the provider relationship. The current
plan assumed that, and it remains the first choice if the server returns.

A rented server moves that work to whoever holds it. Someone must be named to:

- own the provider account and pay for it (we recommend the account is opened by the
  client, with the client's email and payment card, so it never depends on a student
  account);
- keep the operating system patched (automatic security updates cover most of this) and
  reboot after kernel updates;
- watch the daily status email, the alerts and the provider's notices, and act on them
  (certbot renews certificates by itself);
- hold root access and the recovery details.

That is about an hour a month in normal times. The natural choice is Faysal, invited to the
provider account as an administrator, so the arrangement matches today's plan with a
different machine. The owner needs access only until handover. If neither the client nor
Faysal can take it on, Railway is the option with no server to look after, with the limits
above.

## Moving to a new server

### What the pipeline already supports

The deployment was written to be portable, so most of it works for any SSH host:

- **The deploy itself** (`scripts/deploy.sh` and `scripts/deploy-remote.sh`, run by the
  `deploy` job in `.github/workflows/ci.yml`) takes the host, account, port, folder, Docker
  endpoint and both fingerprint pins as settings. The CI job reads the pins from the
  variables `DEPLOY_HOST_FINGERPRINT` and `DEPLOY_KEY_FINGERPRINT` and falls back to the
  client's server's values only when they are unset. It still insists on a rootless daemon
  and a passing public HTTPS health check.
- **Production operations and the daily status check** (`vps-production-ops.yml`,
  `vps-production-status.yml`, `scripts/production-ops-controller.sh`) read the same two
  variables. They are fixed to the folder `/opt/bangla-adventures` and the rootless socket
  `/run/user/1002/docker.sock`, and check that the deployment account has **UID 1002**.
  So on the new server **create the deployment account with UID 1002**: then the default
  socket, the operations and the status check work unchanged, and `DEPLOY_DOCKER_HOST` and
  `DEPLOY_PATH` stay unset.
- **Other CI/CD systems** use the same settings under their own names
  ([CI/CD systems](CI_CD.md)).

What does **not** carry over without a code change: the **SSH preflight**, **image
preflight**, **private staging**, **private acceptance** and **off-site rehearsal**
workflows. They have the client's server's host-key and deploy-key fingerprints written
into them (and private staging is specific to that server), so they would refuse the new
server with "does not match the supplied server fingerprint". They are pre-go-live checks;
production does not need them. Step 5 below repeats the preflight's checks by hand.
Making them read the same variables is a small, separate change.

### Steps and how long they take

`SERVER_ADDRESS` is the new server's public address, `DEPLOY_USER` the deployment account
you create, `ADMIN_USER` the administrator's own account and `DOMAIN` the client's
confirmed name. None of them is ever written into the repository.

| Step | Who | Hands-on time |
| --- | --- | --- |
| 1. Create the server | Client (account holder) | 15 minutes, plus account sign-up |
| 2. Base set-up | Administrator | 30 minutes |
| 3. Deployment account and rootless Docker | Administrator | 45 minutes |
| 4. Deployment folder and settings | Administrator | 10 minutes |
| 5. Keys, host-key pin and a manual preflight | Owner and administrator | 30 minutes |
| 6. GitHub settings | Owner | 30 minutes |
| 7. DNS | Client | 10 minutes, then minutes to a few hours for the record to spread |
| 8. Nginx and certificate | Administrator | 30 minutes |
| 9. Server origin, enable and first deploy | Owner, with the `production` reviewer | 45 minutes |
| 10. Production operations and status check | Owner, with the reviewer | 20 minutes |
| 11. First administrator | Client and administrator | 10 minutes |
| 12. Backups | Client decides; owner configures | As in [Choosing the off-site backup destination](BACKUP_DESTINATIONS.md) |

That is about **4 to 5 hours of hands-on work**, normally over one or two days because of
DNS and approvals. Steps 1 to 6 can be done before the domain is confirmed; steps 7 onwards
need it.

#### 1. Create the server

In the provider's console: Ubuntu 24.04 LTS (x86-64), the chosen region, the chosen plan,
backups switched on, and the administrator's own SSH public key for the first login. Add a
provider firewall allowing only TCP 22, 80 and 443 if the provider offers one. Note the
server's public address (`SERVER_ADDRESS`) privately. Invite the administrator to the
account.

#### 2. Base set-up

Log in as root with the administrator's key, then:

```sh
apt-get update && apt-get -y full-upgrade
apt-get install -y unattended-upgrades ufw
adduser ADMIN_USER && usermod -aG sudo ADMIN_USER
install -d -m 0700 -o ADMIN_USER -g ADMIN_USER /home/ADMIN_USER/.ssh
cp /root/.ssh/authorized_keys /home/ADMIN_USER/.ssh/ && chown ADMIN_USER: /home/ADMIN_USER/.ssh/authorized_keys
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
reboot
```

Then log in as `ADMIN_USER` and confirm `sudo` works before relying on it. Password logins
over SSH should stay off (`PasswordAuthentication no`, the default when the server is
created with a key).

#### 3. Deployment account and rootless Docker

As `ADMIN_USER`. The account gets UID 1002 so the pipeline's fixed socket path applies
(see [What the pipeline already supports](#what-the-pipeline-already-supports)):

```sh
sudo adduser --uid 1002 --disabled-password --gecos '' DEPLOY_USER
grep '^DEPLOY_USER:' /etc/subuid /etc/subgid   # each must show a range of 65536
# Docker's own packages (https://docs.docker.com/engine/install/ubuntu/)
sudo apt-get install -y ca-certificates curl uidmap dbus-user-session systemd-container
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
sudo systemctl disable --now docker.service docker.socket && sudo rm -f /var/run/docker.sock
sudo loginctl enable-linger DEPLOY_USER
sudo machinectl shell DEPLOY_USER@
```

If `grep` shows no range, add one with
`sudo usermod --add-subuids 200000-265535 --add-subgids 200000-265535 DEPLOY_USER`.
In the `machinectl` shell, now running as `DEPLOY_USER`:

```sh
dockerd-rootless-setuptool.sh install
docker --host unix:///run/user/1002/docker.sock info --format '{{json .SecurityOptions}}'   # must include name=rootless
docker compose version                                                                   # 2.17 or newer
exit
```

Use `machinectl shell` (or SSH as the account), never `sudo -iu`: rootless Docker needs
a proper login session. Reboot once and check, without logging in as `DEPLOY_USER`, that
`/run/user/1002/docker.sock` exists again; lingering keeps the daemon and the timers running
with nobody logged in.

#### 4. Deployment folder and settings

```sh
sudo install -d -o DEPLOY_USER -g DEPLOY_USER -m 0750 /opt/bangla-adventures
```

As `DEPLOY_USER`, create `/opt/bangla-adventures/.env` with mode `0600` from
[`deploy/vps.app.env.example`](../deploy/vps.app.env.example), unchanged: `APP_PORT=3001`,
`COMPOSE_PROJECT_NAME=bangla-adventures`, and `PUBLIC_ORIGIN` empty until the domain is
confirmed (an empty origin deliberately stops a deploy). Copy the narration key line only
if the client set it there by hand on the old server.

#### 5. Keys, host-key pin and a manual preflight

**Deployment key.** On the owner's computer, make a new key pair for this server. The old
key was made for the client's server, and a new pair keeps the two apart:

```sh
ssh-keygen -t ed25519 -N '' -C bangla-adventures-deploy -f bangla_deploy
ssh-keygen -lf bangla_deploy.pub    # the SHA256:... value is the new DEPLOY_KEY_FINGERPRINT
```

Send the administrator `bangla_deploy.pub` (the public half only), who installs it as
`/home/DEPLOY_USER/.ssh/authorized_keys`, owned by `DEPLOY_USER`, folder mode `0700`, file
mode `0600`. The private half goes into GitHub in step 6 and is then deleted locally.

**Host-key pin.** As in step 5 of [Automatic deployment](DEPLOYMENT.md#automatic-deployment),
asking for the ED25519 key only, so `server.keys` holds the single line the workflows expect
(in Windows PowerShell 5.1, write the file with `| Out-File -Encoding ascii server.keys`
instead of `>`, as that step explains):

```sh
ssh-keyscan -t ed25519 -p 22 -H SERVER_ADDRESS > server.keys
ssh-keygen -lf server.keys
```

The administrator lists the real fingerprints through the provider's web console, not over
the network being checked:
`for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key"; done`. Use the line only
if the ED25519 fingerprint `ssh-keygen -lf server.keys` prints is exactly the one the
administrator read; if it differs, stop and ask. That `SHA256:...` value is the new
`DEPLOY_HOST_FINGERPRINT`. The hashed line keeps the address out of the file.

**Manual preflight.** Repeat what the SSH preflight checks:

```sh
ssh -i bangla_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=server.keys \
  DEPLOY_USER@SERVER_ADDRESS \
  'id -u; uname -m; test -w /opt/bangla-adventures && echo folder-ok;
   docker --host unix:///run/user/1002/docker.sock info --format "{{json .SecurityOptions}}";
   docker --host unix:///run/user/1002/docker.sock compose version --short; free -m; df -h /opt/bangla-adventures'
```

Expect `1002`, `x86_64`, `folder-ok`, `name=rootless` in the options and Compose 2.17 or
newer.

#### 6. GitHub settings

Keep `DEPLOY_ENABLED` unset or `false` until step 9. GitHub never shows a secret again, so
first confirm the old values are still in Faysal's server handover email, in case the old
server returns. Then, in Settings > Environments (or with `gh`, which prompts for secret
values so they stay out of the shell history):

| Where | Name | Change |
| --- | --- | --- |
| `production` environment secret | `DEPLOY_HOST` | Replace with `SERVER_ADDRESS` (`gh secret set DEPLOY_HOST --env production`) |
| `production` environment secret | `DEPLOY_USER` | Replace with the new account's name |
| `production` environment secret | `DEPLOY_SSH_KEY` | Replace with the contents of `bangla_deploy` (`gh secret set DEPLOY_SSH_KEY --env production < bangla_deploy`) |
| `production` environment variable | `DEPLOY_KNOWN_HOSTS` | Replace with the one line in `server.keys` (`gh variable set DEPLOY_KNOWN_HOSTS --env production < server.keys`) |
| `production-status` environment secrets | `DEPLOY_HOST`, `DEPLOY_USER` | Replace with exactly the same values |
| `production-status` environment variable | `DEPLOY_KNOWN_HOSTS` | Replace with the same line |
| Repository variable | `DEPLOY_HOST_FINGERPRINT` | **New**: the server's `SHA256:...` from step 5 (`gh variable set DEPLOY_HOST_FINGERPRINT --body 'SHA256:...'`) |
| Repository variable | `DEPLOY_KEY_FINGERPRINT` | **New**: the deploy key's `SHA256:...` from step 5 |

The two fingerprint variables go at **repository** level so that both the `production` and
`production-status` jobs see them; unset, the workflows still use the old server's pins and
refuse the new one. Leave `DEPLOY_DOCKER_HOST`, `DEPLOY_DOCKER_CONTEXT`, `DEPLOY_PATH` and
`DEPLOY_PORT` unset. `STATUS_SSH_KEY`, `STATUS_SSH_PUBLIC_KEY`, `ELEVENLABS_*` and the
`production` reviewers stay as they are. Then delete `bangla_deploy` and `server.keys`
locally. ([Server address secrets](VPS_DEPLOYMENT.md#server-address-secrets) explains why
the address and account are secrets.)

#### 7. DNS

Exactly as step 2 of [Going live](VPS_DEPLOYMENT.md#going-live), pointing the `A` record for
`DOMAIN` at `SERVER_ADDRESS`. A short TTL (for example 300 seconds) makes a later move
quicker. Continue once `dig +short DOMAIN` prints `SERVER_ADDRESS`.

#### 8. Nginx and certificate

Ubuntu 24.04 installs Nginx 1.24, the same version as the client's server, so the shipped
site file works unchanged:

```sh
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp bangla-adventures.conf.example /etc/nginx/sites-available/bangla-adventures.conf   # from deploy/nginx/
sudo sed -i 's/example\.org/DOMAIN/g' /etc/nginx/sites-available/bangla-adventures.conf
sudo certbot certonly --nginx -d DOMAIN
sudo ln -s /etc/nginx/sites-available/bangla-adventures.conf /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

On a server of its own, the `http2` and `default_server` cautions in step 3 of
[Going live](VPS_DEPLOYMENT.md#going-live) do not apply. Caddy is an acceptable alternative:
a site block with `reverse_proxy 127.0.0.1:3001` gets its certificate automatically and
forwards the headers the app needs (adapt
[`infra/custom-app/Caddyfile.example`](../infra/custom-app/Caddyfile.example), whose port is
for the native service). We suggest Nginx, because its file is the one already reviewed.

#### 9. Server origin, enable and first deploy

Steps 4 to 8 of [Going live](VPS_DEPLOYMENT.md#going-live), unchanged: set
`PUBLIC_ORIGIN=https://DOMAIN` in the server `.env`, set `PUBLIC_HEALTH_URL`, confirm the
status key is ready, set `DEPLOY_ENABLED=true`, run the CI workflow on `main` and approve the
`deploy` job.

#### 10. Production operations and status check

Step 9 of [Going live](VPS_DEPLOYMENT.md#going-live): run **VPS production operations** with
`install` (the reviewer checks the status key's fingerprint first), then **VPS production
status** once by hand; it must end with `status: healthy`. The installer adds the existing
status key to the new server's `authorized_keys` itself.

#### 11. First administrator

Step 10 of [Going live](VPS_DEPLOYMENT.md#going-live).

#### 12. Backups

The provider's daily backups are on from step 1. The app's own nightly backup and monitor
start with step 10. The off-site copy starts once the client chooses a destination
([Choosing the off-site backup destination](BACKUP_DESTINATIONS.md),
[Off-site copies](PRODUCTION_OPERATIONS.md#off-site-copies)); choose one in a different
company from the server's provider. Then run the agreed restore and rollback exercises.

### What stays the same

- The application, its image (`ghcr.io/omargad/bangla-adventure`, or the client
  organisation's after the [repository transfer](REPOSITORY_TRANSFER.md)), `compose.yaml`,
  the deploy scripts and the server `.env` template.
- The folder `/opt/bangla-adventures`, port `3001`, the Compose project name and the data
  volume.
- The Nginx site file, the 13 MB upload limit and the forwarded headers; the sign-in limits'
  defaults ([Client addresses on each host](DEPLOYMENT.md#client-addresses-on-each-host)).
- The reviewer approval on `production`, the newest-commit rule and the automatic
  rollback of a failed deploy.
- The nightly backup, the 5-minute monitor, the off-site copy design, the status key and the
  daily status email.
- The going-live order, the first administrator steps and the decisions still waiting on
  the client (domain, backup destination, retention, narration key, repository transfer).

### If the client's server comes back

If the old server returns before the move, nothing needs changing. If it returns after,
the client decides which server production stays on; one is enough. To go back, put the old
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` values back in both
environments, delete the two fingerprint variables (the workflows then use the old server's
pins again), point DNS back and move the data with a backup
([Restore into the Compose deployment](BACKUP_RESTORE.md#restore-into-the-compose-deployment)).

## Keep the Railway demo as a stop-gap

While there is no production server, the Railway demo is the place to show the application
to the client, teachers and reviewers. It keeps working without the VPS. Its limits:

- **It is a demonstration, not production.** Its accounts, classes and work are made-up
  demonstration data in its own database, separate from any production data. Nothing
  entered there moves to production, so do not invite real students or families or store
  real recordings there.
- It has no off-site backup, no monitor or status alert, and no reviewer approval: it
  deploys `main` by itself once the GitHub checks pass, built by Railway rather than from
  the tested image.
- It runs on the owner's personal Railway account in Singapore, on the Trial plan's 0.5 GB
  volume. When the Trial ends (30 days from sign-up on 3 November 2026, or sooner once its
  US$5 credit is used) it falls to the Free plan's 0.5 GB memory, which fits the demo's
  measured 0.30 GB peak with little room. Railway says it deletes volumes made on Trial
  accounts 30 days after the Trial's credits expire unless the account is upgraded; to keep
  the demo's data beyond that, move it to the Hobby plan (US$5 a month, which its use fits).
- It has only the `bangla-adventure.up.railway.app` address; the Free plan allows no custom
  domain, so the client's domain stays for production.

If the client needs a real site before a server exists, that is a separate decision: it
would be a production deployment on Railway, with the limits in
[Railway as a managed alternative](#railway-as-a-managed-alternative), not the demo.

## Decisions for the client and owner

1. The date after which this plan is used if the client's server is still unreachable.
2. Who administers the new server, and whose name and card the provider account is in.
3. The provider and region (recommended: DigitalOcean Sydney; runner-up: BinaryLane).
4. Whether to apply for a nonprofit programme first (DigitalOcean's, if still open; AWS's
   only if the client is not a school).
5. Whether the Railway demo moves to the Hobby plan to keep its data past the Trial.
6. Whether the pre-go-live checks (SSH and image preflights, private staging and
   acceptance, off-site rehearsal) should be changed to read the fingerprint variables, so
   they can run against the new server too.

## Sources

Read on 8 November 2026:

- DigitalOcean: [Droplet pricing](https://www.digitalocean.com/pricing/droplets),
  [backups pricing](https://docs.digitalocean.com/products/backups/details/pricing/),
  [Droplet availability](https://docs.digitalocean.com/products/droplets/details/availability/),
  [DO for Nonprofits & Social Enterprises](https://www.digitalocean.com/blog/driving-impact-do-for-nonprofits-social-enterprises)
  (2023 announcement) and [DO Impact](https://www.digitalocean.com/impact).
- Vultr: [pricing](https://www.vultr.com/pricing/) (including its FAQ on regional prices and
  automatic backups), [data centre regions](https://www.vultr.com/features/datacenter-regions/),
  [free tier programme](https://www.vultr.com/free-tier-program/).
- Akamai (Linode): [CPU plans and pricing](https://www.akamai.com/cloud/pricing/cpu),
  [backups pricing](https://www.akamai.com/cloud/pricing/backups),
  [Backups service](https://techdocs.akamai.com/cloud-computing/docs/backup-service),
  [Shared CPU Linodes](https://techdocs.akamai.com/cloud-computing/docs/shared-cpu-compute-instances),
  [region availability](https://www.akamai.com/why-akamai/global-infrastructure/availability).
- AWS: [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/),
  [Nonprofit Credit Program](https://aws.amazon.com/government-education/nonprofits/nonprofit-credit-program/).
- Hetzner: [Regular Performance cloud servers](https://www.hetzner.com/cloud/regular-performance),
  [cloud overview](https://www.hetzner.com/cloud/),
  [locations](https://docs.hetzner.com/cloud/general/locations/),
  [backups and snapshots](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/).
- BinaryLane: [Linux VPS](https://www.binarylane.com.au/vps-hosting).
- Railway: [pricing](https://railway.com/pricing), [pricing plans](https://docs.railway.com/pricing/plans),
  [volume backups](https://docs.railway.com/volumes/backups),
  [volume size limits](https://docs.railway.com/volumes/reference),
  [Free Trial and data retention](https://docs.railway.com/pricing/free-trial),
  [deployment regions](https://docs.railway.com/networking/edge-networking),
  [wait for CI](https://docs.railway.com/deployments/github-autodeploys); and the demo
  project's settings and 7-day metrics.
- Docker: [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
  [rootless mode](https://docs.docker.com/engine/security/rootless/) and its
  [troubleshooting page](https://docs.docker.com/engine/security/rootless/troubleshoot/)
  (Ubuntu 24.04 AppArmor note, `machinectl`, lingering).

The application's needs come from `compose.yaml`, the `Dockerfile`,
[DEPLOYMENT.md](DEPLOYMENT.md), [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md),
[PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md) and the workflows in
`.github/workflows/`.
