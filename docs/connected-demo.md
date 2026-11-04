# Connected four-role demonstration

Scenario: **Our Bangladesh — a heritage journey**. Tim Marco teaches Camel and five fictional classmates in the existing **Demo Class**. They explore national symbols, rivers, New Year celebrations and crafts. Frank Samo follows Camel's progress. The administrator supports new applicants and monitors the same class.

All extra learners, applicants, attendance and submissions are synthetic demonstration records. Existing sign-in credentials are never included in this document or changed by the seed.

## Pass 1: administrator

| Screen | Source | Data and presentation |
|---|---|---|
| Users and approval queue, `/admin` | `app/admin/UserManagement.tsx`, `/api/admin/users` | Three pending applicants: Samira Khan (student), Nusrat Khan (parent), Ayesha Rahman (teacher request). Leave them pending until presenting approval. |
| Family links | `app/admin/FamilyLinks.tsx`, `lib/parent-access.ts` | Frank is linked to Camel only. |
| Class allocation, `/admin/classes` | `app/admin/classes/AdminClasses.tsx` | Tim's Demo Class contains Camel, Maya, Arif, Nadia, Rafi and Zara. |
| Grades and results, `/admin/results` | `app/admin/results/AdminResults.tsx` | Same persisted submissions and attendance shown to Tim, Camel and Frank. |
| Lessons, topics and textbook links | `app/studio`, `app/teach/topics`, `app/admin/sources` | Existing approved curriculum is preserved. Demo activities link to its published topics; do not create a second curriculum or claim imported textbook files. |

## Pass 2: teacher

| Workspace section | Backing records | Demo state |
|---|---|---|
| Class overview and Students | `classes`, `students`, `class_students`, `student_class_enrollments` | Six active learners; existing Camel enrolment reused. |
| Activities & quizzes | `class_activities` | Four ordered topic-linked activities. First three are closed practice; fourth is open for the presentation. Questions come from the app's approved topic baseline. |
| Results | `activity_submissions`, `student_topic_progress` | Varied quiz results, two missing submissions, topic-reading progress. Marks are calculated from actual stored answer indexes with the app's grader. |
| Attendance | `class_attendance` | Three simulated historical sessions, Camel present at all three; two classmates each miss one session. |
| Announcements | `class_announcements` | A shared unit introduction, a student revision reminder and a parent home-discussion note. |
| Class sources | `class_sources` | Official NCTB source catalogue, with directions to the existing topic references. |

The app's class assignment unit is a topic-linked quiz/activity. Language lessons live in the shared learning catalogue; there is no separate teacher-to-class lesson scheduling table. The demo uses the existing supported workflow.

## Pass 3: student

`app/student/StudentPortal.tsx` loads `/api/student/feed` and the curriculum. Camel's My Learning page shows three read topics, three of four activities complete, one class and three of three sessions attended. The first quiz has one deliberate mistake; the next two have full marks. My results shows the three persisted submissions. The open crafts activity is the final demonstration step: read the topic, answer the questions and submit to update the teacher and parent views.

The seed marks topics as read but does not fabricate a separate built-in topic-quiz attempt. Class quiz marks and topic-quiz marks are distinct features.

## Pass 4: parent

`app/family/ParentDashboard.tsx` and `lib/parent-access.ts` show Frank only Camel's class, teacher, activities, submissions, calculated average, attendance, shared/parent announcements and class sources. Frank cannot edit work or marks. Classmates' results and the student-only revision reminder must be absent.

## Seed operation

`scripts/seed-connected-demo.ts` supports two modes:

- Local: requires a new, explicit database path and `DEMO_LOCAL_PASSWORD` (test-only secret supplied outside source control). Creates the four local equivalents, then the scenario.
- Live: requires the existing four approved accounts and exactly one empty Demo Class belonging to Tim. Refuses changed roles, unexpected enrolments, existing activities/attendance, extra parent links or identifier collisions. It does not bootstrap a missing live database.

Live mode defaults to a read-only preflight. `--apply` makes a SQLite online backup before a single immediate transaction. A durable `demo_seed_runs` marker makes subsequent runs no-ops, preserving later approvals and presentation work. Additional fixtures have random discarded passwords and require a password change if access is later issued. No email is sent.

```sh
# New isolated database only; supply DEMO_LOCAL_PASSWORD privately.
DATABASE_PATH=/tmp/bangla-connected-demo/local.db node --import tsx scripts/seed-connected-demo.ts --local --apply

# Read-only production preflight (no --apply).
DATABASE_PATH=/app/.data/bangla-adventures.db node --import tsx scripts/seed-connected-demo.ts --live

# Apply only after local tests AND all local role screenshots pass.
DATABASE_PATH=/app/.data/bangla-adventures.db node --import tsx scripts/seed-connected-demo.ts --live --apply
```

## Presentation order (about 12 minutes)

1. Admin (2 minutes): pending applicants, approve the demo student, show Tim's class allocation and Camel's family link. Keep the other two applicants pending for another run.
2. Teacher (4 minutes): six-person roster; linked learning topics and four activities; gradebook with varied results and missing work; attendance; audience-specific announcements; source catalogue.
3. Camel (3 minutes): existing progress, previous results, then the open crafts activity. Submit one real demo attempt and show the saved score.
4. Frank (2 minutes): Camel's overview, class and all four activities; confirm the new result and completion count after refresh. Explain read-only access.
5. Admin (1 minute): return to aggregate results to close the loop.

## Release gate and evidence

Do not run the live seed until the isolated database passes integrity, grade consistency, rerun/no-overwrite, approval, teacher scope, student result and parent-privacy checks **and** screenshots of all four local roles have been inspected. After live seeding, capture the same live screens and compare counts. Never present a local screenshot as live evidence. Keep databases, backups, credentials and session tokens out of Git.

Validation results and screenshot paths are recorded separately after execution; this guide is a runbook, not a claim that live seeding has happened.

## Reproduce validation

Use the repository's supported Node 22 runtime and install dependencies with `npm ci`.

```sh
node --import tsx --test tests/connected-demo.test.mjs
npm run build
node --test tests/integration/connected-demo-flow.test.mjs
npm run typecheck
npx playwright test --config playwright.demo.config.ts
```

The dedicated screenshot configuration creates a fresh temporary database and random local test password. It captures 13 views across the four roles to `test-results/connected-demo/`. It never accepts a live URL and does not use production credentials. Its browser capture step still needs to be executed and visually reviewed; passing API checks alone does not satisfy the release gate.

## Current validation checkpoint — 5 November 2026

- Production build passed in the available Node 24.22.1 workspace runtime. Node 22 is the repository's supported runtime; the downloaded Node 22 executable could not run in this workspace. Node 22 CI validation remains required.
- 27 focused unit checks passed, including three demo-specific tests covering grade consistency, foreign keys, safe reruns, backup preservation and live-mode preflight.
- Both connected-demo integration checks passed against a newly seeded local app: all four role APIs and page routes, approval flow, parent isolation, and final student submission propagation.
- Local screenshot suite prepared but not yet run. The available cloud browser returned `ERR_CONNECTION_REFUSED` for the workspace's local preview.
- No live demo records, account credentials, Railway settings or main-branch application code changed at this checkpoint.
