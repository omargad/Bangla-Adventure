# Bangla Adventures — handover deliverables

This index lists the project deliverables named in the client handover checklist: the
source code, the technical documentation and the user guides. It then lists the project
records and summarises the delivery status and the items still waiting on the client at
handover. It points to the documents that hold the detail; where the two differ, the
linked document is the authority.

Bangla Adventures is an ICT Project B capstone for clients Dr Tanjila Kanij (project owner)
and K. M. Abul Faysal Ibn Alam (Faysal Alam, technical contact). The delivered product is the
custom English–Bangla application (`PLATFORM_MODE=legacy`), with portals for students
(`/student`), teachers (`/teach`), administrators (`/admin`) and families (`/family`).

## Source code

| Item | Where |
| --- | --- |
| Repository | <https://github.com/omargad/Bangla-Adventure> |
| Branch | `main`. Hand over a specific commit or release with its verification evidence ([source handover](HANDOVER.md)). |
| Container image | `ghcr.io/omargad/bangla-adventure`, published by the CI pipeline; it becomes `ghcr.io/ORG/bangla-adventure` once the repository moves to the client's organisation ([Repository transfer](REPOSITORY_TRANSFER.md)) |

**What the repository contains.** The Next.js 16, React 19 and TypeScript application with
SQLite and local media storage; the Docker and Compose set-up (`Dockerfile`, `compose.yaml`);
native service templates in [`infra/custom-app/`](../infra/custom-app/); the prepared VPS
settings, Nginx site and scheduled production jobs in [`deploy/`](../deploy/); pipeline
files for ten CI/CD systems; the backup and restore tools; the test suites; and the optional
Moodle 5.2 pilot plugin in [`moodle/`](../moodle/). `.env.example` documents the local defaults and production settings.
Real accounts, sessions, student records, uploaded media, passwords and recovery codes are
deliberately not in the repository ([Open and run](HANDOVER.md#open-and-run)).

**Build, run and test.** Use Node.js 22 and npm.

- Run it locally: `npm ci`, then `npm run dev`, and open `http://localhost:3000`. See
  [Run the application locally or in Codespaces](../README.md#run-the-application-locally-or-in-codespaces)
  in the README and [Open and run](HANDOVER.md#open-and-run) in the source handover.
- Check it: the commands are in [Quality checks](../README.md#quality-checks) in the README.
  The clean-checkout sequence used for release evidence is in
  [Verification evidence](HANDOVER.md#verification-evidence), and a release build for a
  server is in [Build and verify an isolated release](DEPLOYMENT.md#build-and-verify-an-isolated-release).
- Deploy it: the [deployment guide](DEPLOYMENT.md) covers the container and native options,
  and [VPS deployment](VPS_DEPLOYMENT.md) covers the client's prepared server.

**Container image.** On `main`, the CI pipeline publishes each commit's image as
`ghcr.io/omargad/bangla-adventure:sha-COMMIT` once its container test passes, and tags that
same image `latest` once every check has passed; nothing is rebuilt between testing and
deployment ([Automatic deployment](DEPLOYMENT.md#automatic-deployment)). Image names follow the
current repository owner, so the name changes if the repository moves to another GitHub owner;
[Repository transfer](REPOSITORY_TRANSFER.md#container-images) covers the new package and the
copy of the private staging image. The same `Dockerfile` runs on other
container hosts that provide a persistent local disk, one running copy and HTTPS
([Other container hosts](DEPLOYMENT.md#other-container-hosts)).

**Licence and content boundaries.** The repository has no licence file, and `package.json`
marks the package as `private`. The README section
[Source and content boundaries](../README.md#source-and-content-boundaries) sets out what the
source does and does not cover:

- `app/nctb-books.ts` records current official NCTB source metadata and direct
  government-hosted downloads.
- `app/nctb-content.ts` is an explicit review queue; its lesson bridges remain
  `pending-educator-review`.
- `content-sources/` holds audit and extraction evidence, not learner-ready copy.
- Original accessible HTML must be written and reviewed for the diaspora audience; textbook
  scans are never embedded as the lesson interface.
- Stories, poems, images, recordings and video need exact rights, consent, attribution,
  accessibility and suitability evidence.

## Technical documentation

Documents a maintainer or operator needs, in the order they are usually read.

| Document | What it is for |
| --- | --- |
| [README: Architecture](../README.md#architecture) | The application's layers, storage and hosting at a glance |
| [Source handover](HANDOVER.md) | Opening and running the source, deployment ownership, administrator and role handover, verification evidence, backups and release contents |
| [Deployment guide](DEPLOYMENT.md) | Installing the custom application: prerequisites, release builds, the native service and container options, other container hosts, automatic deployment, the first administrator and recovery, backups, upgrade and rollback, and Bangla audio |
| [VPS deployment](VPS_DEPLOYMENT.md) | The prepared settings for the client's VPS: server address secrets, settings to complete, the narration key, the first release and the going-live steps |
| [If the server's address or host key changes](SERVER_CHANGE.md) | For the owner and the server administrator: telling which case applies from what the administrator reports and what the SSH preflight says, then the GitHub settings and server preparation for the same server on a new address, a rebuilt or new server, or a server gone for good |
| [Hosting fallback plan](HOSTING_FALLBACK.md) | For the client and the owner, in case the client's VPS does not come back: what the app needs from a host, prices of small servers in Australia and Singapore (as of 8 November 2026) and Railway, the recommended server, who would administer it, the steps and time to move the pipeline to it, and the Railway demo as a stop-gap |
| [Repository transfer](REPOSITORY_TRANSFER.md) | Moving the repository to the client's GitHub organisation: permissions and organisation settings, the settings to note and check, the container images, Railway and local clones |
| [CI/CD systems](CI_CD.md) | Running the same checks, image publishing and deployment on GitHub Actions, which runs on every push today, or on nine other CI/CD systems from the same shared scripts |
| [Production operations](PRODUCTION_OPERATIONS.md) | The scheduled backup, monitor, encrypted off-site copy and daily status alert for production, installed at go-live; the off-site rehearsal on the VPS; restoring, stale locks and failure codes |
| [Choosing the off-site backup destination](BACKUP_DESTINATIONS.md) | For the client: why an off-site copy, its size and cost, the storage options with the recommendation and runner-up, making a key limited to one bucket, what to send and how, the key custodian and the retention decision |
| [Backup and restore](BACKUP_RESTORE.md) | Creating and verifying database and media backups, restore drills into a new directory, restoring into the Compose deployment, and encrypted off-server copies |
| [Private staging](PRIVATE_STAGING.md) | The separate private staging deployment on the VPS, used before the public domain is ready |
| [Private staging operations](PRIVATE_STAGING_OPERATIONS.md) | The backup and monitoring jobs that apply to private staging only |
| [Private staging rollback](PRIVATE_STAGING_ROLLBACK.md) | Rehearsing a release rollback with the real release engine against a disposable project |
| [Role and access management (RBAC)](ACCESS_CONTROL.md) | One table of who can do what for students, parents, teachers and administrators (also as [CSV](RBAC.csv) and an [Excel workbook](RBAC.xlsx)), then account states, every page and API route, data scoping, operational access and known gaps |
| [Content approval](CONTENT_APPROVAL.md) | Who submits and who approves each kind of content (topics, lessons, recordings, videos, class activities and class links), and how existing records are treated |
| [Media review](MEDIA_REVIEW.md) | Checking lesson videos and playlists, which voice learners hear, human recordings, generating Bangla clips with ElevenLabs, and automatic narration |
| [Acceptance record](ACCEPTANCE.md) | The release acceptance and review record: release identity, evidence ledger, role journeys and the sign-off rule |
| [Verification record](VERIFICATION.md) | Recorded local and GitHub Actions results for the 28 October 2026 deployment and recovery fixes; not a live-server acceptance certificate |
| [NCTB content audit](NCTB_CONTENT_AUDIT.md) | The 11 August 2026 audit of the NCTB textbook sources and PDFs, and its limits |
| [NCTB reading notes](NCTB_READING_NOTES.md) | What was read from the ingested NCTB texts, and what changed in the app as a result |
| [Moodle-first MVP plan](MOODLE_FIRST_MVP.md) | The 12 August 2026 Moodle-first plan; the Moodle pilot remains an alternative implementation, not the current live account and classroom system |

Related technical documents outside `docs/`:

| Document | What it is for |
| --- | --- |
| [Native service templates](../infra/custom-app/README.md) | The systemd, environment and Caddy examples for a native installation |
| [Moodle pilot deployment](../infra/moodle/README.md) | The alternative single-VM Moodle 5.2 deployment |
| [Moodle plugin guide](../moodle/README.md) | Packaging, installing and the release boundary of the hidden Moodle pilot course |
| [NCTB content sources](../content-sources/README.md) | How the NCTB textbooks are ingested and their text extracted |

## User guides

Step-by-step guides for each role, written for non-technical readers, with screenshots that
use made-up people.

| Guide | For |
| --- | --- |
| [User guides index](user-guides/README.md) | Which guide to read, and how accounts and approval work |
| [Student guide](user-guides/student.md) | Students, and the grown-up helping them |
| [Parent guide](user-guides/parent.md) | Parents and carers |
| [Teacher guide](user-guides/teacher.md) | Teachers |
| [Administrator guide](user-guides/administrator.md) | The school's Administrators |
| [Content review pack](CONTENT_REVIEW_PACK.md) | The first Administrator and the content reviewers: who checks the 15 topics and 18 lessons, what to check, the order and time, with a worksheet ([Excel](content-review-worksheet.xlsx), [CSV](content-review-worksheet.csv)) |

## Project records

| Record | What it holds |
| --- | --- |
| [Contribution register](../CONTRIBUTIONS.md) | Who did what, by Jira item, with import commits, GitHub issues and files |
| [Jira task map](JIRA_TASK_MAP.md) | Every Jira SCRUM item with its GitHub record and repository parts (28 October 2026 snapshot) |
| [File ownership](FILE_OWNERSHIP.md) | The owner of each file, generated from the import history on 28 October 2026 |
| [Original contribution evidence](ORIGINAL_CONTRIBUTIONS.md) | Original commits recovered from earlier repositories |
| [`jira-task-mapping.json`](jira-task-mapping.json) and [`atlassian-role-mapping.json`](atlassian-role-mapping.json) | Machine-readable Jira mappings behind the registers above |
| [Client requirements, 10 August 2026](CLIENT_REQUIREMENTS_2026-08-10.md) | Every requirement raised at the 10 August 2026 client meeting, mapped to the platform's state |
| [Project pack](PROJECT_PACK.md) | The 2 August 2026 project pack, prepared before the 10 August meeting re-scoped the project |
| [First client meeting agenda](FIRST_MEETING_AGENDA.md) | The agenda prepared for the first client meeting (historical) |
| [Client outreach email draft](CLIENT_EMAIL_DRAFT.md) | The draft of the first email to the client (historical) |
| [Demo completion](demo-completion.md) | The operator command that completes the browser-created demonstration class with synthetic work |

## Status and outstanding items

### Delivery status

This restates the README's [Honest delivery status](../README.md#honest-delivery-status).

| Area | Status | Detail |
| --- | --- | --- |
| Custom platform for learners, teachers, parents and admins | Implemented | Deployed; role checks, staff allocation, learning progress and parent monitoring implemented |
| Official NCTB catalogue and PDF audit | Implemented, with review or handover outstanding | Source records implemented; a verified PDF is not an approved adaptation |
| Bilingual topics and lessons | Implemented, with review or handover outstanding | Complete Bangla instruction copy is staged for Admin review; approved snapshots control learner views. Qualified educator, source and community review remain pending |
| Bangla audio | Implemented, with review or handover outstanding | Approved human recordings play first, then provider clips, the device voice and the bundled eSpeak voice; ElevenLabs is the chosen provider and generation waits for the client's key (Azure remains an alternative); native-speaker review and reviewed recordings remain incomplete |
| Application deployment and operations | Implemented, with review or handover outstanding | Docker image, Compose and native service setups, an automatic deployment pipeline for the ten most used CI/CD systems and backup and restore tools included; deployment to the client's server, off-site backups and a recovery exercise still to do |
| Moodle pilot course | Implemented, with review or handover outstanding | Installable hidden-course plugin implemented: 15 bilingual chapters, nine activities and nine questions |
| Optional Moodle publication control | Deliberately gated | Draft validation passes; pilot release validation intentionally fails while 27 human-review gates are pending |
| YouTube and media verification | Not complete | Media excluded from the first pilot |
| Curriculum, accessibility and child review | Not complete | — |
| Privacy, safeguarding and legal approval | Not complete | — |

As the README says, a successful build proves that the software compiles. It does not approve
Bangla, historical claims, copyright, age suitability, accessibility or child safety. Every
row of the [acceptance record](ACCEPTANCE.md)'s evidence ledger is still pending a named
reviewer.

### Go-live items waiting on the client

These come from [Going live](VPS_DEPLOYMENT.md#going-live) and
[First release](VPS_DEPLOYMENT.md#first-release) in the VPS deployment guide and from the
[source handover](HANDOVER.md). Leave deployment disabled (`DEPLOY_ENABLED=false`) until
access and the domain are ready ([CI/CD systems](CI_CD.md#how-every-pipeline-behaves)).

| Item | What is needed | Where it is described |
| --- | --- | --- |
| Domain and DNS | The client confirms one public name. An `A` record for it points at the server's public address (an `AAAA` record only if the server has a public IPv6 address that reaches Nginx). A bare domain also commits every subdomain to HTTPS through the app's HSTS header, so the owner confirms that first. The server `.env` then gets `PUBLIC_ORIGIN=https://DOMAIN`. | [Going live](VPS_DEPLOYMENT.md#going-live), steps 1, 2 and 4 |
| Nginx site and certificate | Faysal installs the prepared site file from `deploy/nginx/bangla-adventures.conf.example` with the confirmed name, gets the certificate with certbot before enabling the site, and checks renewal. | [Going live](VPS_DEPLOYMENT.md#going-live), step 3 |
| First administrator | The agreed person creates an account at `/grown-ups` and keeps the recovery codes; in the deployment directory the operator runs `docker compose exec app npm run admin:grant -- EMAIL`; that person signs in again at `/grown-ups?returnTo=/admin&switchAccount=1`. | [Going live](VPS_DEPLOYMENT.md#going-live), step 10; [Administrator and role handover](HANDOVER.md#administrator-and-role-handover) |
| Backup destination and retention | The client agrees the off-site destination and its cost, the schedule and retention, and who holds the backup repository's password. The off-site copy stays inert until it is configured, and remote retention stays off until a policy is agreed (proposed: 14 daily, 8 weekly and 6 monthly copies). The 14 local archives kept on the server are a technical default, not agreed retention. A recovery exercise and a rollback exercise follow in an agreed window. | [Choosing the off-site backup destination](BACKUP_DESTINATIONS.md); [Going live](VPS_DEPLOYMENT.md#going-live), step 11; [Off-site copies](PRODUCTION_OPERATIONS.md#off-site-copies); [Backups and release contents](HANDOVER.md#backups-and-release-contents) |
| ElevenLabs key | Optional. The client buys an ElevenLabs plan or obtains nonprofit credits, creates the API key and passes it privately to the repository owner, who adds it as the `ELEVENLABS_API_KEY` secret of the `production` environment; or the server administrator writes it into the server `.env`. Until then the site works with its existing recorded audio. Confirm the spending limit, key rotation owner and persistent audio storage before enabling it. | [Narration key](VPS_DEPLOYMENT.md#narration-key); [Deployment and ownership](HANDOVER.md#deployment-and-ownership) |
| GitHub organisation and repository transfer | The client confirms the destination GitHub organisation or repository and its permissions for Actions and Packages. The pipeline does not transfer repository ownership; the workflows need no change for the move. While the repository belongs to the personal account `omargad`, only that account can add Actions secrets; after the move, an administrator of the client's organisation does it. | [Repository transfer](REPOSITORY_TRANSFER.md); [First release](VPS_DEPLOYMENT.md#first-release), step 1; [Narration key](VPS_DEPLOYMENT.md#narration-key) |

The same documents also list these decisions for the client: whether the new site starts
empty or receives approved existing data; whether the client wants to approve each release
(a reviewer on the `production` environment); and who owns hosting, domain and TLS, support,
backup storage and recovery keys.

### Known issues recorded in the user guides

The user guides were written against commit `c4cb7ae` and have been updated for the
access-control and guide fixes made since. The issues they first recorded are fixed: the
**The 18 lessons** card opens the lessons, attendance saves and who made each change appear in
**Recent changes**, the gradebook counts only published activities, the teacher-request page
warns that approval ends a parent's view of linked children, and a suspended account is told it
is suspended (once the right password is entered). Behaviour that changed and that the guides
now describe:

- a class activity is handed in once; the teacher can reset a submission
  ([Student guide](user-guides/student.md#class-activities));
- only the first 3 tries at a topic quiz each day can raise the saved best score
  ([Student guide](user-guides/student.md#do-the-topic-quiz));
- a parent is told when a linked child's account is not active
  ([Parent guide](user-guides/parent.md#reading-results-and-attendance));
- an Administrator's own topics, recordings, class activities and class sources are published at
  once, and the switches **Teachers' topics need an administrator's approval**, **Teachers' class
  activities need an administrator's approval** and **Teachers' class sources need an
  administrator's approval** (each on by default, under **Who needs approval**) decide whether
  teachers' topics, class activities and class sources wait
  ([Administrator guide](user-guides/administrator.md#who-needs-approval),
  [Teacher guide](user-guides/teacher.md#whether-your-topics-wait-for-approval) and
  [activities and sources](user-guides/teacher.md#whether-your-activities-and-sources-wait-for-approval),
  [Content approval](CONTENT_APPROVAL.md#who-approves-what));
- 429 messages say how long to wait.

Screenshots taken before these changes that still show old text: the parent results panel had its
status badge removed by hand; the others do not show the changed text.
