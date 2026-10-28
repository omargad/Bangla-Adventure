# Bangla Adventures — source handover

This package contains the current application source, including the latest
administrator/session fixes, student announcements and direct Learning topics
sidebar navigation. It includes uncommitted working-tree changes; it is not an
export of the older initial Git commit.

## Open and run

Use Node.js 22 and npm. From the extracted project folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Configuration examples are in `.env.example`.
Keep `PLATFORM_MODE=legacy` for the deployed custom application. The Moodle
directories are the separate alternative pilot, not a requirement for running
the custom application.

For a production build:

```sh
npm run build
npm start
```

Production authentication requires HTTPS. Put the application behind an HTTPS
reverse proxy and configure `PUBLIC_ORIGIN` to its public address. Use persistent
locations for `DATABASE_PATH` and `MEDIA_ROOT`; do not replace them during updates.
If setting `MEDIA_ROOT`, use an absolute path.

The runtime schema is created/migrated automatically. A fresh installation starts
with an empty database. Real accounts, sessions, learner records, uploaded media,
passwords and recovery codes are deliberately not included in this source package.

## Set up the client's administrator

1. Have the confirmed client owner register an adult account and privately save
   the recovery codes displayed at registration.
2. On the intended deployment, using the same `DATABASE_PATH` as the application:

   ```sh
   npm run admin:grant -- YOUR_REGISTERED_EMAIL
   ```

3. Sign in again and open `/admin`. There are no default administrator credentials,
   and ordinary registration never grants administrator access.

Portals: `/student`, `/teach`, `/admin`, `/family`.
Teachers require administrator approval. Teachers/admins allocate students to
classes; students do not enter class codes. Parent access requires an administrator
to link the registered parent and student accounts.

## Verify

```sh
npm run build
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
NEXT_DIST_DIR=.next-test npm run test:integration
```

Browser and API tests use temporary databases. Do not point tests at production
data. The browser test runner builds `.next-test`; the final command reuses that
build for API tests.

The supplied Dockerfile is another deployment option. Its container build was
not executed as part of this source-package verification.

## Upload to GitHub

Extract the ZIP, then upload or commit the **contents of the project folder**,
including `.github`, `.gitignore`, `.dockerignore` and `.env.example`.
Do not upload only the ZIP as the repository contents.

`node_modules`, `.next*`, test outputs, local databases and real `.env` files are
excluded. `npm ci` and the build recreate dependencies and generated output.
Never commit production data, private certificates, passwords or recovery codes.
The package has no `.git` directory; initialise the client's repository and create
a release commit/tag after uploading.

The downloadable package also contains `infra/current-server/` reference copies
of the Bangla service/timer configuration and certificate-deployment hook, plus
only the Bangla Caddy site blocks. They describe the existing host, with its paths
and build-directory names. Adapt them to a new host and provision its own TLS
certificates; private keys and unrelated sites are not included. This is reference
configuration, not an automated server installation.

## Client acceptance and operations

Give the client the live link, their administrator access, role-specific usage
instructions, a test/demo record, this source release and an agreed support owner.
Confirm hosting responsibility, off-server backups and a tested restore procedure.
The existing host serves other projects: use application-scoped access or
client-owned hosting rather than handing over shared-server root access.

Software verification does not approve the educational content. Draft review
notices and publication gates remain in place. Curriculum/language accuracy,
media rights, accessibility and privacy/safeguarding reviews require their named
human owners before being recorded as accepted.
