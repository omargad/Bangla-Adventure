# Native custom-application templates

These examples support the active `PLATFORM_MODE=legacy` application on a new
Linux host. They are not an installer and do not modify any server.

Use [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for prerequisites, persistent
storage, build verification, bootstrap, upgrades and recovery.

| File | Operator destination/action |
| --- | --- |
| `bangla-adventures.service` | Review and install as `/etc/systemd/system/bangla-adventures.service` |
| `app.env.example` | Copy privately to `/etc/bangla-adventures/app.env`; replace origin, retain absolute persistent paths; root-owned `0600` |
| `Caddyfile.example` | Replace example hostname and merge the site block into the existing proxy configuration |

Create the dedicated application account and a tested release under
`/opt/bangla-adventures/releases/<commit>`. Point `/opt/bangla-adventures/current`
to that release, ensure `.next/cache` exists, and create the persistent media/cache
directories with the correct owner before starting the service. Verify the Node.js
22 binary path in the unit. Validate the systemd unit and complete Caddy
configuration on the actual host before enabling/reloading them.

The service runs one process on loopback `3300`. The named cache bind mount makes
Next's cache writable while the release is read-only. Database and media remain
under `/var/lib/bangla-adventures` when a release changes.

These templates do not configure DNS, certificate renewal for a particular IP,
off-server backups, external monitoring, administrator privileges or content
approval. Record those actual setup results in the acceptance ledger.

`../current-server/` is historical reference for the existing installation, which
uses a different mount/release layout. Do not overwrite that live configuration
with these templates without a separately reviewed migration.
