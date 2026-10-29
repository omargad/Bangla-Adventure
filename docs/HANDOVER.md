# Bangla Adventures — source handover

The canonical source is
[`omargad/Bangla-Adventure`](https://github.com/omargad/Bangla-Adventure).
Hand over a specific commit or release with its verification evidence.
[`CONTRIBUTIONS.md`](../CONTRIBUTIONS.md) records Jira responsibility areas; it does
not reconstruct authorship for the original source snapshot.

## Open and run

Use Node.js 22 and npm, from a checkout or extracted source release:

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. `.env.example` documents local defaults and production
settings. Keep `PLATFORM_MODE=legacy` for the custom app. Moodle is an alternative
pilot, not a requirement for the student/teacher/admin/family portals.

SQLite and its tables are created automatically on first use. A fresh installation
starts empty. Real accounts, sessions, student records, uploaded media, passwords
and recovery codes are deliberately absent from GitHub. Continuing an existing
site requires a verified private database/media transfer, not test fixtures.

## Deployment and ownership

Follow [`DEPLOYMENT.md`](DEPLOYMENT.md) for native service or container setup.
Production needs HTTPS, the actual `PUBLIC_ORIGIN`, persistent `DATABASE_PATH` and
an absolute persistent `MEDIA_ROOT`. Run one instance. Uploading source or opening
a Codespace does not configure production hosting or restore its data.

`infra/custom-app/` contains new-host templates for operator review.
`infra/current-server/` records the existing host's paths, build directories and
site blocks. Do not copy historical paths to another host or replace unrelated
proxy sites. Private keys and unrelated configurations are not included.

Agree who owns hosting, domain/TLS, support, backup storage and recovery keys. The
existing host serves other projects: provide application-scoped access or use
client-owned hosting instead of transferring shared-server root access.

## Administrator and role handover

1. Confirm the client's account identity. Have the intended owner register an
   adult account through HTTPS and privately save the recovery codes. Like every
   self-registered account, it then waits for administrator approval and cannot
   sign in yet.
2. On the intended deployment, run `npm run admin:grant -- YOUR_REGISTERED_EMAIL`
   using the **same `DATABASE_PATH`** as the app. The command makes the account an
   administrator **and approves it**. Native/Compose commands are in
   [`DEPLOYMENT.md`](DEPLOYMENT.md#first-administrator-and-recovery).
3. Sign in again at `/grown-ups?returnTo=/admin&switchAccount=1`. Promotion revokes
   previous sessions. There are no default admin credentials or public admin signup.

Students, parents and teachers who register themselves wait in the administrator's
**Waiting for approval** queue on the Users page until they are approved (approving
a teacher request also approves the account); declined accounts cannot sign in
until an administrator approves them later (a declined teacher applicant is then
approved as a teacher). A suspended account leaves the queue and is approved or
declined only after it is reactivated. Accounts an administrator creates are
approved and get a generated temporary password, shown once on a printable sheet;
the person must choose their own password at first sign-in, and adults then receive
fresh recovery codes. Administrators can reset a forgotten student or adult password
the same way (never their own). Staff find approved students by name or username
and tick them to allocate them, without class codes; admins link approved parents
to approved student accounts for read-only access. **Import families (CSV)** on the
Users page takes one file of student name, parent name and parent e-mail: it creates
the students and any new parents, links them (siblings share one parent; a child
with two parents shares one username across both rows), can allocate a class, and
shows a printable sign-in sheet with one page per family. A student username that
already exists links that student instead, and a name that already has a student
account is refused unless the administrator confirms it is a different child, so a
repeated upload never creates second accounts. Password recovery uses saved recovery codes, not email-reset
messages. Demonstrate the flow and transfer recovery material privately.

## Verification evidence

See [VERIFICATION.md](VERIFICATION.md) for the recorded local and GitHub Actions
results. Repeat the relevant checks when implementation or deployment changes.

From a clean checkout without production credentials or data configured:

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
NEXT_DIST_DIR=.next-test npm run test:integration
```

Browser/API tests use temporary databases. Do not run type checking while builds
replace generated types. Record the commit, runtime, commands, results and any
unavailable checks; a workflow definition is not a passing run. Container testing
is a separate CI smoke check; record its actual result before Docker acceptance.

Use [`ACCEPTANCE.md`](ACCEPTANCE.md) for role journeys, educational/media reviews,
accessibility, client sign-off and responsible owners. A working website or GitHub
upload is not evidence of human acceptance.

## Backups and release contents

Use [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) to create a verified database/media
backup and restore it into a new isolated directory. Confirm the off-server
destination, encryption/key custody, schedule, retention, backup-age alerts and an
actual recovery drill. Templates and tests do not enable a production backup job.

Keep state outside releases and preserve it across upgrades. Retain the prior
release and take a verified pre-upgrade backup; review schema compatibility before
rollback. Never overwrite live state with fixtures or unverified archives.

The repository includes `.github`, `.gitignore`, `.dockerignore`, `.env.example`,
schema/bootstrap code and operating templates. Dependencies, generated builds,
test output, databases, media uploads, backup archives and real environment files
stay out of source control. `npm ci` and the build recreate their outputs.

Provide the client with the release/commit URL, lockfile, setup/recovery runbooks,
role demonstrations, test evidence, acceptance record and support contact. Source
archives may omit `.git`; the repository URL and commit identify the release.

Educational content retains its draft/review notices. Curriculum/language accuracy,
age suitability, media rights, accessibility and privacy/safeguarding decisions
require their responsible human reviewers. Record evidence and remaining
restrictions instead of marking unfinished work approved.
