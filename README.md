# Bangla Adventures

A bilingual platform for Bangladeshi-heritage children outside Bangladesh,
focused on **culture, history and literature**. This is an ICT Project B
capstone with clients Dr Tanjila Kanij and Faysal Alam.

## Current product decision

The running deployment uses the **custom English–Bangla application**, following
the owner's 20 September 2026 decision. `PLATFORM_MODE=legacy` is the configuration
name for this mode; it does not mean the running portals are retired.

- Students use My Learning, learning topics, allocated classes, activities and results.
- Teachers require administrator approval and allocate students without class codes.
- Administrators manage accounts, family links, class allocation and topic-reading updates.
- Parents have read-only access to administrator-linked children's learning records.
- Learning content requires sign-in. Curriculum edits retain educator-review notices;
  saving a topic is not approval of its educational accuracy, rights or age suitability.

The Moodle pilot remains an **alternative implementation**, not the current live
account/classroom system. Its hidden-course and publication gates remain intact.
See [`docs/MOODLE_FIRST_MVP.md`](docs/MOODLE_FIRST_MVP.md) for that earlier plan.

## Honest delivery status

| Area | Status |
| --- | --- |
| Official NCTB catalogue and PDF audit | Source records implemented; a verified PDF is not an approved adaptation |
| Bilingual topic prototypes | Implemented as drafts; educational/community review remains |
| Moodle pilot course | Installable hidden-course plugin implemented: 15 bilingual chapters, nine activities and nine questions |
| Automated publication control | Draft validation passes; release validation intentionally fails while 27 gates are pending |
| Custom learner/teacher/parent/admin platform | Deployed; role checks, staff allocation, learning progress and parent monitoring implemented |
| Human Bangla audio | Not complete |
| YouTube/media verification | Not complete; media excluded from the first pilot |
| Curriculum, accessibility and child review | Not complete |
| Privacy, safeguarding and legal approval | Not complete |
| Application deployment and operations | Running on HTTPS with automatic restart, health checks and certificate-renewal checks; client ownership and off-server recovery arrangements still need handover |

A successful build proves that the software compiles. It does not approve
Bangla, historical claims, copyright, age suitability, accessibility or child
safety.

## Client-aligned scope

The 10 August 2026 client meeting re-scoped the core away from a new language
course. Community Bangla schools already teach language; the missing resource
is a systematic, English-first culture/history/literature strand with optional
Bangla translation and trustworthy NCTB evidence.

The pilot therefore does **not** use CEFR A1–C2 labels. CEFR can describe a
future language pathway, but it does not measure cultural or historical depth.
The course instead states target age/context, reading support, activity
scaffolds, outcomes and teacher success criteria.

## First Moodle pilot

`moodle/local/banglapilot/` contains an installable Moodle 5.2 local plugin for:

1. Ekushey and the Language Movement;
2. Pohela Boishakh; and
3. folk tales and retelling.

Each candidate module has five substantial bilingual draft chapters, a
three-question quiz and a teacher-reviewed response. Official NCTB source
anchors and nine mandatory gates cover source mapping, Bangla, English
adaptation, cultural/historical accuracy, age suitability, rights,
accessibility, media safety and a consented child pilot.

```bash
npm run verify:moodle-pilot   # validates a draft and reports blockers
npm run verify:moodle-plugin  # validates the installable Moodle plugin boundary
npm run moodle:package        # builds a checksummed local_banglapilot.zip
npm run verify:moodle-release # must fail until all review evidence is approved
```

The controlled lesson, manifest and GIFT sources are packaged under
`moodle/local/banglapilot/data/`. The seeder creates the hidden course
repeatably; it has no command that can publish it.

## Learning and reference surfaces

| Route | Pilot role |
| --- | --- |
| `/topics` | Draft bilingual topic review experience |
| `/books` | Audited NCTB Book Bridge and precise source metadata |
| `/library` | Adult-facing textbook catalogue |
| `/resources` | External research register; not approved curriculum |
| `/safety` | Current safety/accessibility statements for review |

Learning/reference pages require a valid session; `/safety` remains public.
If a future deployment selects `PLATFORM_MODE=moodle`, the configured custom LMS
routes redirect to Moodle and their data APIs return `410 Gone`.

## Technology

| Layer | Choice |
| --- | --- |
| Running application | Next.js 16, React 19, TypeScript |
| Running application storage | SQLite + local filesystem; single application instance |
| Optional Moodle pilot | Moodle 5.2.2 + MariaDB 10.11, separately provisioned |
| Current hosting | Linux service behind Caddy, HTTPS on an IP address |
| Handover requirements | Agreed hosting ownership, off-server backups, restore verification and named support/review owners |

Moodle core is used before optional plugins. The first pilot has no paid LMS,
paid plugin, mobile app or LTI dependency.

## Run the application locally or in Codespaces

Use Node.js 22.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. A Codespace is a development environment, not a
production host for children or persistent Moodle data.

To test the Moodle hand-off locally, provide a local or HTTPS Moodle URL:

```dotenv
PLATFORM_MODE=moodle
MOODLE_URL=http://localhost:8080
NEXT_PUBLIC_MOODLE_URL=http://localhost:8080
```

Production accepts HTTPS only. See `.env.example`.

## Quality checks

```bash
npm run lint
npm test
npm run verify:moodle-pilot
npm run verify:moodle-plugin
npm run verify:moodle-infra
npm run build
npm run test:integration
npm run test:e2e
```

Additional audits:

```bash
npm run verify:media  # candidate YouTube IDs; run where YouTube is reachable
npm run verify:links  # external resource register
npm run fetch:nctb    # controlled NCTB ingestion; PDFs themselves are not lessons
```

CI validates the draft manifest. A future deployment workflow must call
`verify:moodle-release`; it is intentionally not treated as passing while human
review is incomplete.

## Source and content boundaries

- `app/nctb-books.ts` records current official source metadata and direct
  government-hosted downloads.
- `app/nctb-content.ts` is an explicit review queue. Its lesson bridges remain
  `pending-educator-review`.
- `content-sources/` contains audit/extraction evidence, not learner-ready copy.
- Original accessible HTML must be written and reviewed for the diaspora
  audience; textbook scans are never embedded as the lesson interface.
- Stories, poems, images, recordings and video require exact rights, consent,
  attribution, accessibility and suitability evidence.

## Current deployment and handover

- Website: <https://31.56.120.148>. Portals: `/student`, `/teach`, `/admin`, `/family`.
- `bangla-adventures.service` runs the application on loopback3300 as a dedicated
  non-root user. Caddy provides HTTPS. Health checks run every minute and
  certificate-renewal checks run every six hours.
- Persistent database: `/var/lib/bangla-adventures/bangla-adventures.db`.
  Uploaded media uses the neighbouring `media` directory. Existing data is
  independent of build directories and must not be replaced by test fixtures.
- Deployment configuration sets `PUBLIC_ORIGIN`, `DATABASE_PATH`, `MEDIA_ROOT`
  and `NEXT_DIST_DIR`. Build updates into a new directory; verify them before
  changing the service's build path and cache mount. Retain the previous build.
- Local database snapshots were taken before significant changes. An off-server
  backup schedule and a documented restore exercise remain handover tasks.
- Give the client a versioned source release, dependency lockfile, setup and
  operational instructions, role-specific user guides, test evidence and a
  signed acceptance/known-issues list. The repository still needs a confirmed
  GitHub remote and publishing identity before its latest work can be pushed.
- Provision the client's administrator only after confirming their account.
  Transfer credentials/recovery material separately and securely. The current
  host also serves other projects: use application-scoped access or dedicated
  client-owned hosting rather than transferring shared-server root access.
- Curriculum, privacy/safeguarding, media rights and independent accessibility
  review remain separate from software test results.

For the alternative Moodle deployment, use
[`infra/moodle/README.md`](infra/moodle/README.md); its infrastructure and
publication prerequisites still apply.

## Key documents

- `docs/MOODLE_FIRST_MVP.md` — recovery decision, scope and definition of done
- `moodle/README.md` — plugin packaging, installation and release boundary
- `docs/NCTB_CONTENT_AUDIT.md` — PDF/source audit and its limits
- `docs/CLIENT_REQUIREMENTS_2026-08-10.md` — requirement traceability
- `docs/MEDIA_REVIEW.md` — unverified-video and human-audio process
- `infra/moodle/README.md` — cheapest credible deployment runbook
