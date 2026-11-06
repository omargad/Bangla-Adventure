# Isolated VPS release rollback rehearsal

`scripts/private-staging-rollback.sh RUN_ID` exercises the actual, unchanged
`scripts/deploy-remote.sh` release engine against a disposable rootless Compose
project. It never runs a failed candidate against the real staging database.
The runner must upload this script, `deploy-remote.sh` and
`private-staging-verify.mjs` together in its owned acceptance payload.

The fixed trusted application image is the existing revision `95b6308` digest
`sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2`.
The source staging app must be healthy, portless, zero-user and at its exact
15-pending-topic / 18-pending-lesson state before and after the exercise.

The rehearsal holds the same staging deployment lock as other operations. A
read-only SQLite online backup is exported to an exclusively owned temporary
directory in the source container, copied privately, then removed. Because the
verified source has no media files, the clone receives an empty media directory.
The live source app remains running throughout.

The clone lives under
`/opt/bangla-adventures/private-staging/rollback/<24-hex-ID>`, owned by `deployer`
with mode `0700`. Its unique project, data volume and internal network publish no
TCP port. Only the clone volume is mounted by the rehearsal application.

A never-started, unmounted container from the trusted image is committed locally
with a fixed Node HTTP-503 command and ownership labels. No source snapshot,
credential or mounted data is part of that builder or derived image. The real
release engine first makes its normal pre-deployment clone backup, promotes the
candidate image/configuration, sees failed health and automatically restores the
previous image and configuration. The exercise requires both an observed HTTP
503 response and Docker's candidate-unhealthy event before accepting recovery.

Successful proof requires the previous image, Compose bytes, deployment-script
bytes and environment bytes to be restored; HTTP health to return 200; and the
full logical database digest to remain unchanged. Image rollback does not
restore database contents. The independent backup/restore exercise remains a
different check.

The production workflow's mandatory public HTTPS check remains unchanged. The
portable engine's `require_public_health=false` option is used only for this
isolated portless fixture, so the proof concerns internal health and rollback.
A final public HTTPS rollback exercise still belongs to the agreed production
release window after the real domain and proxy are configured.

Cleanup checks resource ownership before removing the clone, network, candidate
image and private fixture directory. A mismatched graph is retained for operator
recovery instead of deleting an unrelated resource. Output contains only bounded
aggregate checks, image IDs and logical digests. Raw databases, backups and
deployment logs are never exported in the evidence artifact.

A successful workflow and its exported result are runtime proof. The script and
offline tests alone do not establish that the VPS exercise has passed.
