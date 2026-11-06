# Role and access management

Bangla Adventures uses **role-based access control (RBAC)**. Every person who signs in has one role
(student, parent, teacher or administrator), and what they may see or change depends on that role, on
the state of their account, and on which records are theirs (their own account, the classes they
teach, the children linked to them).

Access is enforced on the server, never only by hiding buttons:

1. [`proxy.ts`](../proxy.ts) runs before every page, file and API request. It checks the request's
   origin, rejects malformed JSON, answers retired endpoints, lets public paths through, and requires a
   valid session for everything else.
2. Each page and each API route then checks the account type and role itself
   ([`lib/auth.ts`](../lib/auth.ts), [`lib/student-auth.ts`](../lib/student-auth.ts),
   [`lib/roles.ts`](../lib/roles.ts)) and limits the data to the caller's scope
   ([`lib/class-access.ts`](../lib/class-access.ts), [`lib/enrollments.ts`](../lib/enrollments.ts),
   [`lib/parent-access.ts`](../lib/parent-access.ts), [`lib/families.ts`](../lib/families.ts),
   [`lib/user-management.ts`](../lib/user-management.ts)).
3. Library functions that change shared data re-read the acting account inside the database
   transaction and refuse if it no longer has the right (for example
   `lib/user-management.ts:35-38`, `lib/curriculum-catalog.ts:222-231`).

Roles and states are read from the database on every request. A suspension, a role change or a
decline therefore takes effect on the next request, and those changes also delete the account's
existing sessions (`lib/user-management.ts:144,179`).

This document describes the code at commit `c4cb7aec031e3d1104709a5ae154e449c94c5ab5`. Evidence is
given as `file:line`.

**Contents:** [Roles and account states](#roles-and-account-states) ·
[RBAC table](#role-based-access-control-rbac-table) · [Page access](#page-access) ·
[API access](#api-access) · [Data scoping rules](#data-scoping-rules) ·
[Account management rules](#account-management-rules) · [Global protections](#global-protections) ·
[Operational access](#operational-access-outside-the-app) · [Known gaps](#known-gaps) ·
[How this was verified](#how-this-was-verified)

## Roles and account states

### Roles

There are two account types. **Adults** (parent, teacher, administrator) sign in with an e-mail address
at `/grown-ups` and get the `ba_adult_session` cookie. **Students** are separate accounts with a
username, sign in at `/student` and get the `ba_student_session` cookie. Signing in as one type clears
the other type's cookie (`app/api/auth/sign-in/route.ts:58`, `app/api/student/sign-in/route.ts:54`).

| Role | What it is | How someone gets it | Home page |
| --- | --- | --- | --- |
| **Visitor** (signed out) | No usable session. Also every suspended, pending, declined or expired account. | Nothing to do. | `/welcome` |
| **Student** | A student account (`students` table). | Self-registration at `/student`, then administrator approval (`lib/student-auth.ts:60`). Or created by an administrator (`POST /api/admin/users`) or by the family CSV import: approved at once, with a temporary password (`lib/user-management.ts:205,211`; `lib/families.ts:149,165`). Or created by an approved teacher's class CSV import: approved at once, with a temporary password (`lib/enrollments.ts:208`; `db/schema.ts:221`). | `/student` |
| **Parent** | Adult with `role` parent. | Self-registration at `/grown-ups`, then administrator approval (`lib/auth.ts:122-133`). Or created by an administrator, or by the family CSV import, approved with a temporary password. | `/family` |
| **Teacher** | Adult with `role` teacher and `teacherStatus` approved. | Self-registration choosing "teacher": the account is a parent with a pending teacher request until an administrator approves both (`lib/user-management.ts:158-167`). Or an approved parent asks from `/teach` (`POST /api/auth/teacher-request`) and an administrator approves. Or an administrator creates a teacher account, or changes an adult's role to teacher. | `/teach` |
| **Administrator** | Adult with `role` admin. | The **first** administrator is made by the server operator with `npm run admin:grant -- EMAIL` against the app's database, which also approves the account (`scripts/grant-admin.ts:11-19`; [DEPLOYMENT.md](DEPLOYMENT.md#first-administrator-and-recovery)). Later ones only by an existing administrator changing a role (`PATCH /api/admin/users/[id]`). There is no public administrator sign-up, and `POST /api/admin/users` cannot create one. | `/admin` |

The role checks used everywhere are in `lib/roles.ts`:

| Helper | Meaning | Evidence |
| --- | --- | --- |
| `canManageUsers` | Active administrator. | `lib/roles.ts:15-17` |
| `canTeach` | Active administrator, or active teacher with `teacherStatus` approved. | `lib/roles.ts:19-21` |
| `canPublishContent` | `canManageUsers`, approved account, and not using a temporary password. Needed to approve or withdraw anything learners see. | `lib/roles.ts:24-26` |
| `accountHome` | Administrator: `/admin`. `canTeach` or a pending teacher request: `/teach`. Otherwise `/family`. | `lib/roles.ts:28-31` |

A parent with a pending or rejected teacher request still has role parent, so everywhere in this
document they are in the **Parent** column (with home page `/teach` while the request is pending).

### Account states

| State | Applies to | Effect |
| --- | --- | --- |
| **Pending approval** (`approvalStatus` pending) | Self-registered adults and students | No session can be created or used (`lib/auth.ts:155-156`, `lib/student-auth.ts:76-77`, `lib/learning-session.ts:21-28`). Sign-in with the right password answers 403 with an approval notice; with a wrong password, the usual 401. Listed in the administrator's approval queue. |
| **Declined** (`approvalStatus` declined) | Adults and students | Same as pending: no session, 403 notice after the correct password. An administrator can approve the account later. A declined teacher applicant is approved as a teacher (`lib/user-management.ts:159-167`). |
| **Suspended** (`status` suspended) | Adults and students | No session. Sign-in answers the same 401 as a wrong password, so the state is not revealed. Suspending deletes live sessions (`lib/user-management.ts:179`). Must be reactivated before it can be approved or declined (409). |
| **Teacher request pending** (`teacherStatus` pending, role parent) | Parents | Parent access only. `/teach` shows "Your teacher request is with us" (`app/teach/page.tsx:10`); every class and studio API answers 403 "An approved teacher account is required." (`lib/auth.ts:101-104`, `app/api/classes/route.ts:15`). |
| **Teacher request rejected** (`teacherStatus` rejected, role parent) | Parents | Parent access only. `/teach` says the earlier request was not approved and offers to ask again, at most 3 times per 24 hours (`app/api/auth/teacher-request/route.ts:12-13`). |
| **Temporary password must be changed** (`mustChangePassword`) | Accounts created or reset by an administrator (adults and students), or created by an import | **Adults:** the proxy lets them reach only `/account/password`, `/api/account/password`, public paths and static files. Other APIs answer 403 `{error:"Choose your own password before you continue.", mustChangePassword:true}`, other pages redirect to `/account/password?returnTo=…` (`proxy.ts:53-56`). Cleared by changing the password or by recovery. **Students:** every student data API answers the same 403 (`lib/student-auth.ts:114-119`) and learner pages redirect to `/student/password` (`lib/student-auth.ts:122-124`). |
| **Expired session** | Everyone | Sessions last 30 days (`lib/auth.ts:36`, `lib/student-auth.ts:19`). An expired session counts as signed out. |

## Role-based access control (RBAC) table

This is the capability matrix. Each row is something a person can do; the cells say whether each role
can do it, and over which records.

**Legend:** ✅ allowed · ❌ not allowed · *text* = allowed, limited to that scope ·
"own classes" = classes the teacher teaches (`classes.teacherId` = self) · "linked children" =
students an administrator linked to the parent · "all" = every record in the system.
"Teacher" means an **approved** teacher. A suspended, pending or declined account is a Visitor. An
adult with a temporary password can only change it (and use public pages) until they do.

### Learning

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| Open public pages (`/welcome`, `/safety`, both sign-in pages) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read approved topics and the learning hubs (`/topics`, `/learn`, alphabet, numbers, stories and the other hubs) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Use the textbook library and references (`/library`, `/books`, `/resources`, `/references`) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Play approved lessons and practise words (`/adventure`, `/practice`) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Hear approved recordings of a lesson (`/api/audio/…`) | ❌ | approved lessons | approved lessons | any lesson | any lesson |
| Print worksheets (`/worksheets`) | ❌ | approved lessons | approved lessons | every lesson's newest draft | every lesson's newest draft |
| Print a certificate (`/certificate`) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Record own topic reading and topic-quiz results | ❌ | own record | ❌ | ❌ | ❌ |
| Hear generated narration of an approved topic | ❌ | ✅ | ✅ | ✅ | ✅ |
| Hear generated narration of a class activity | ❌ | own classes, approved and open | linked children's classes, approved and open | own classes, any state | all |
| Keep home learner profiles, progress and lesson assignments (`/family` "Home learners") | ❌ | ❌ | view own only (read-only) | own | own |

### Classes

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| See the classes one is in, with approved activities | ❌ | own classes | linked children's classes | ❌ | ❌ |
| List classes | ❌ | ❌ | ❌ | own classes | own classes, or all with `?scope=all` |
| Open a class (roster, activities, announcements) | ❌ | ❌ | ❌ | own classes | all |
| Create a class for oneself | ❌ | ❌ | ❌ | ✅ | ✅ |
| Create a class for another teacher | ❌ | ❌ | ❌ | ❌ | ✅ |
| Give a class to another teacher | ❌ | ❌ | ❌ | ❌ | ✅ |
| Delete a class (with its roster, activities and submissions) | ❌ | ❌ | ❌ | own classes | all |
| Search every active, approved student to add to a class | ❌ | ❌ | ❌ | into own classes | into any class |
| Allocate or remove a student | ❌ | ❌ | ❌ | own classes | all |
| Import students by CSV (creates student accounts with temporary passwords) | ❌ | ❌ | ❌ | own classes | all |
| Create, open, close or remove an activity | ❌ | ❌ | ❌ | own classes (new activities wait for approval) | all (approved at once) |
| Approve or reject a class activity | ❌ | ❌ | ❌ | ❌ | ✅ |
| Submit answers to an activity | ❌ | own classes, approved and open | ❌ | ❌ | ❌ |

### Results and attendance

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| See own results | ❌ | own record | ❌ | ❌ | ❌ |
| See results and attendance of a child | ❌ | ❌ | linked children | ❌ | ❌ |
| Gradebook and CSV export | ❌ | ❌ | ❌ | own classes | all |
| Reset a submission so the student can try again | ❌ | ❌ | ❌ | own classes | all |
| Take and edit attendance | ❌ | ❌ | ❌ | own classes | all |
| See the topic progress of a class's students | ❌ | ❌ | ❌ | own classes | all |
| Results summary across all classes (`/admin/results`) | ❌ | ❌ | ❌ | ❌ | ✅ |

### Announcements and sources

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| Read class announcements | ❌ | own classes (for everyone or students) | linked children's classes (for everyone or parents) | own classes (every audience) | all |
| Post or remove a class announcement (no approval step) | ❌ | ❌ | ❌ | own classes | all |
| Read class sources | ❌ | own classes, approved | linked children's classes, approved | own classes, every state | all |
| Add, edit or remove a class source | ❌ | ❌ | ❌ | own classes (saved as waiting for approval) | all (approved at once) |
| Approve or reject a class source | ❌ | ❌ | ❌ | ❌ | ✅ |
| Change the textbook library catalogue (`/admin/sources`) | ❌ | ❌ | ❌ | ❌ | ✅ |

### Content authoring and approval

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| Open the topic and lesson studios (`/teach/topics`, `/studio`) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Write a new topic or edit any topic (saved as a new version waiting for approval) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Preview unapproved topic versions, lesson drafts and recordings | ❌ | ❌ | ❌ | ✅ | ✅ |
| Approve or send back a topic version; withdraw or restore a topic | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approve or withdraw a lesson revision; decide on a lesson's video | ❌ | ❌ | ❌ | ❌ | ✅ |
| Upload a recording for a lesson (waits for approval) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Approve, send back or retire a recording | ❌ | ❌ | ❌ | ❌ | ✅ |
| Keep curriculum drafts | ❌ | ❌ | ❌ | own drafts | own drafts |
| Mark a curriculum draft "approved for release" | ❌ | ❌ | ❌ | ❌ | own drafts |
| Record a specialist check on a lesson (informational) | ❌ | ❌ | ❌ | own check | own check |

### Accounts and families

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| Register a student account (waits for approval) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Register a parent account, or apply as a teacher (waits for approval) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ask to become a teacher (`/teach`) | ❌ | ❌ | ✅ | already | already |
| See linked children (`/family`) | ❌ | ❌ | linked children | ❌ | ❌ |
| List and search users, see the approval queue and the latest audit events | ❌ | ❌ | ❌ | ❌ | all |
| Approve or decline accounts and teacher requests | ❌ | ❌ | ❌ | ❌ | all |
| Create parent, teacher or student accounts with a temporary password | ❌ | ❌ | ❌ | students only, via own class CSV import | ✅ (not administrators) |
| Change a role, suspend or reactivate, end someone's sessions | ❌ | ❌ | ❌ | ❌ | role and status: others only; sessions: anyone, own included |
| Make someone an administrator | ❌ | ❌ | ❌ | ❌ | others only |
| Reset someone's password to a temporary one | ❌ | ❌ | ❌ | ❌ | others only |
| Import families by CSV (students, parents, links, class) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Link or unlink a parent and a student | ❌ | ❌ | ❌ | ❌ | ✅ |

### Own account

| Capability | Visitor | Student | Parent | Teacher | Administrator |
| --- | :-: | :-: | :-: | :-: | :-: |
| Sign in and sign out (this browser) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change own password | ❌ | ✅ | ✅ | ✅ | ✅ |
| Reset a forgotten password with a recovery code | ❌ | ❌ (an administrator resets it) | ✅ | ✅ | ✅ |
| Replace own recovery codes | ❌ | ❌ | ✅ | ✅ | ✅ |
| Sign out on every device | ❌ | ❌ | ✅ | ✅ | ✅ |
| Download own data (JSON export) | ❌ | ❌ | ✅ | ✅ | ✅ |
| Delete own account | ❌ | ❌ | ✅ | ✅ (also deletes the classes they teach; see [Known gaps](#known-gaps)) | ❌ (another administrator must change the role first) |

## Page access

Signed-out visitors are sent by the proxy to `/grown-ups?returnTo=…` for `/teach`, `/admin`,
`/family`, `/studio`, `/account` and their subpaths, to `/welcome` for `/`, and to
`/welcome?returnTo=…` for every other non-public page (`proxy.ts:61-64`, `lib/learning-policy.ts:48-52`).
An adult with a temporary password is sent from every page except the public ones to
`/account/password?returnTo=…` (`proxy.ts:53-56`). A student with a temporary password is sent from
learner pages to `/student/password` (`app/components/LearningLayout.tsx:10`,
`app/components/PasswordChangeGate.tsx:6`). All redirects are 307.

| Page | Visitor | Student | Parent | Teacher | Administrator | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | → `/welcome` | → `/student` | → `/family` (→ `/teach` while a teacher request is pending) | → `/teach` | → `/admin` | `proxy.ts:61-63`; `app/page.tsx:7-15` |
| `/welcome`, `/safety` | ✅ | ✅ | ✅ | ✅ | ✅ | `lib/learning-policy.ts:4` |
| `/grown-ups` | ✅ sign-in form | ✅ adult sign-in form | → `returnTo` or home | → `returnTo` or home | → `returnTo` or home | `app/grown-ups/page.tsx:16-28` |
| `/student` | ✅ sign-in form | ✅ portal (→ `returnTo` if given) | ✅ student sign-in form | ✅ student sign-in form | ✅ student sign-in form | `app/student/page.tsx:25-32` |
| `/student/password` | → `/welcome?returnTo=…` | ✅ own | → `/student?returnTo=…` | → `/student?returnTo=…` | → `/student?returnTo=…` | `app/student/password/page.tsx:13-17` |
| `/classroom` (retired) | → `/student` | → `/student` | → `/student` | → `/student` | → `/student` | `proxy.ts:48` |
| `/account` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | ✅ own | ✅ own | ✅ own | `app/account/page.tsx:13`; `lib/auth.ts:77-84` |
| `/account/password` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | → `/account` (form only while a temporary password is set) | → `/account` | → `/account` | `app/account/password/page.tsx:16-24` |
| `/family` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | ✅ linked children | ✅ own home learners | ✅ own home learners | `app/family/page.tsx:10-12` |
| `/teach` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | 200 "Request teacher access" screen (or request status) | ✅ "My classes" | ✅ "All classes" | `app/teach/page.tsx:9-11` |
| `/teach/topics`, `/studio` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | → `/teach` | ✅ (cannot approve) | ✅ (can approve) | `app/teach/topics/page.tsx:10-11`; `app/studio/page.tsx:10-11`; `lib/auth.ts:86-90` |
| `/admin` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | 200 "Administrator access required" panel | 200 same panel | ✅ users and approvals | `app/admin/page.tsx:10-12` |
| `/admin/classes` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | → `/family` | → `/family` | ✅ | `app/admin/classes/page.tsx:7-8` |
| `/admin/results`, `/admin/sources` | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=…` | → `/family` (or `/teach`) | → `/teach` | ✅ | `app/admin/results/page.tsx:8-9`; `app/admin/sources/page.tsx:10-11` |
| `/admin/curriculum` (retired) | → `/grown-ups?returnTo=…` | → `/grown-ups?returnTo=%2Fteach%2Ftopics` | → `/teach` | → `/teach/topics` | → `/teach/topics` | `app/admin/curriculum/page.tsx:6-7` |
| `/topics`, `/learn`, `/library`, `/references`, `/books`, `/resources`, `/alphabet`, `/calendar`, `/explore`, `/grammar`, `/numbers`, `/phrasebook`, `/poems`, `/stories` | → `/welcome?returnTo=…` | ✅ | ✅ | ✅ | ✅ | `app/components/LearningLayout.tsx:6-12` and each page's `layout.tsx` |
| `/practice`, `/adventure` | → `/welcome?returnTo=…` | ✅ approved lessons | ✅ approved lessons | ✅ approved lessons | ✅ approved lessons | `app/practice/page.tsx:13-16`; `app/adventure/page.tsx:12-17` |
| `/certificate` | → `/welcome?returnTo=…` | ✅ | ✅ | ✅ | ✅ | `app/certificate/layout.tsx:3` |
| `/worksheets`, `/worksheets/[lessonId]` | → `/welcome?returnTo=…` | ✅ approved lessons (404 otherwise) | ✅ approved lessons (404 otherwise) | ✅ every lesson's newest draft | ✅ every lesson's newest draft | `app/worksheets/page.tsx:23-27`; `app/worksheets/[lessonId]/page.tsx:13-17` |

Notes:

- `/references` adds the class sources of the student's own classes only for a student with no adult
  session and no temporary password (`app/references/page.tsx:15`).
- `/grown-ups` keeps a signed-in adult on the form with `?switchAccount=1`, or when `returnTo` is an
  `/admin` path and the adult is not an administrator. An adult with a temporary password is sent to
  the password form only when the page would otherwise redirect (`app/grown-ups/page.tsx:23-25`).
- `/student` looks only at the student session, so an adult with a temporary password sees the
  student sign-in form there (observed in the probe; `app/student/page.tsx:27-30`).
- When a browser holds both cookies, pages and the proxy prefer the adult session
  (`lib/learning-session.ts:20-29`, `app/components/LearningLayout.tsx:7-11`); `/student` and
  `/student/password` still use the student session.
- The sidebar ([`app/components/PortalShell.tsx`](../app/components/PortalShell.tsx), lines 165-192)
  shows each role only its own links, but every page and API repeats the check on the server.
- Every page re-checks the session in the browser on load, on focus and every 60 seconds, and leaves
  when the account changes or is signed out (`app/components/PwaBridge.tsx:63-80`).

## API access

Every API that is not public first passes the proxy. These answers are the same for every route in the
table and are not repeated in it:

| Code | Status and body | When |
| --- | --- | --- |
| `ORIGIN403` | 403 `{error}`: "Cross-site requests are not allowed." / "The request origin could not be verified." / "Send JSON or a same-origin upload." | Any POST, PUT, PATCH or DELETE (and GET on a `/sign-out` path) from another site, before anything else (`proxy.ts:36-37`). |
| `JSON400` | 400 `{error:"Send a valid JSON object with the required fields."}` | A POST, PUT, PATCH or DELETE whose `Content-Type` starts with `application/json` and whose body is not a JSON object, before sign-in is checked (`proxy.ts:39-46`). Not on `/api/narration`. |
| `P401` | 401 `{error:"Sign in to access learning content."}` | No usable session on a non-public API (`proxy.ts:58-60`). |
| `PW403` | 403 `{error:"Choose your own password before you continue.", mustChangePassword:true}` | Adult with a temporary password, on any API except `/api/account/password` and public ones (`proxy.ts:53-54`). |

Route-level answers used in the table:

| Code | Status and body | Evidence |
| --- | --- | --- |
| `R401` | 401 "Sign in required." (no adult session; this is what a student gets on adult APIs) | `lib/auth.ts:99` |
| `T403` | 403 "An approved teacher account is required." | `lib/auth.ts:101-104` |
| `A403` | 403 "Administrator access required." | `lib/auth.ts:101-104` |
| `S401` | 401 "Student sign in required." (no student session; this is what an adult gets on student APIs) | `lib/student-auth.ts:116` |
| `SPW403` | 403 "Choose your own password before you continue." with `mustChangePassword:true` (student temporary password) | `lib/student-auth.ts:105-106` |
| `RO403` | 403 "Parent accounts have read-only access to learning records." | `app/api/assignments/route.ts:27,56` |
| `C404` | 404 "Class not found." Also for a class that exists but is not the caller's, so other teachers' classes are not revealed. | `lib/class-access.ts:12-21` |
| `429` | 429 "Too many attempts. Please wait a moment and try again." with `Retry-After` | `lib/rate-limit.ts:59-64` |

"Teacher" in the *Who* column means `canTeach` (approved teacher or administrator). Denials are listed in
the order the route checks them; a **400 before a 403/404** is called out because a validation error
can then appear before the access decision.

### Sign-in, sign-up and own account

| Route | Method | Who | Scope | Denials (in order) | Evidence |
| --- | --- | --- | --- | --- | --- |
| `/api/auth/sign-in` | POST | Anyone (public) | Own credentials; with `requireAdmin:true`, administrators only | 400 "Signing in needs a secure https:// address." (production, plain-http origin on another host); 429 (100 per 15 min per address); 400 "Enter your email and password."; 429 (failures: 10 per address and account, 50 per account, per 15 min); 401 "That email and password do not match." (also for suspended accounts); 403 approval notice with `approvalStatus` (pending or declined, correct password only); 403 not an administrator with `requireAdmin` | `app/api/auth/sign-in/route.ts:16-60` |
| `/api/auth/sign-up` | POST | Anyone (public) | Creates role parent, `approvalStatus` pending; `accountType` teacher adds a pending teacher request; returns 8 recovery codes once | 429 (5 per hour per address, counted before validation); 400 validation ("Choose a parent or teacher account." for anything else, including admin); 409 "An account with this email already exists. Sign in instead." | `app/api/auth/sign-up/route.ts:14-48`; `lib/auth.ts:114-137` |
| `/api/auth/recover` | POST | Anyone (public), adult accounts | Own account by e-mail and one unused recovery code | 400 insecure origin; 429 (5 per 15 min per address); 400 "Enter your email and one recovery code."; 400 password not 10–200 characters; 401 "That email and recovery code do not match, or the code was already used."; 403 approval notice (the code is not used up) | `app/api/auth/recover/route.ts:16-56`; `lib/auth.ts:237-247` |
| `/api/auth/sign-out` | GET | Anyone (public) | Ends this browser's adult and student sessions; 303 to a safe `returnTo` with `Clear-Site-Data: "cache"` | `ORIGIN403` when cross-site; other methods 405 | `app/api/auth/sign-out/route.ts:6-15`; `lib/browser-logout.ts:9-25` |
| `/api/auth/session` | GET | Anyone (public) | Own session: key, role, home. Visitors get `authenticated:false`, home `/welcome`; temporary-password adults get home `/account/password` | none (always 200) | `app/api/auth/session/route.ts:6-8`; `lib/session-status.ts:6-12` |
| `/api/auth/teacher-request` | POST | Parent (teacher, administrator and a parent whose request is already pending: 200, no change) | Own account: `teacherStatus` none or rejected → pending | `P401`, `PW403`; `R401`; 429 (3 per 24 h per adult); 403 "Account unavailable. Sign in again." Needs a JSON body `{}` | `app/api/auth/teacher-request/route.ts:9-25` |
| `/api/account/password` | POST | Any adult, also with a temporary password | Own account; keeps this session, ends the others; replaces recovery codes after a temporary password | `P401`; `R401`; 429 (`account:<id>`, 10 per 15 min, shared with recovery codes and delete); 400 password not 10–200 characters; 400 same as current; 403 "Your current password is incorrect." (400 before 403) | `app/api/account/password/route.ts:12-42`; `lib/auth.ts:216-230` |
| `/api/account/recovery-codes` | POST | Any adult | Own account; 8 new codes, the old ones stop working | `P401`, `PW403`; `R401`; 429 (shared); 403 incorrect password | `app/api/account/recovery-codes/route.ts:8-25` |
| `/api/account/delete` | POST | Parent, teacher | Own account and the records it owns; a teacher's classes are deleted too | `P401`, `PW403`; `R401`; 429 (shared); 409 "Ask another administrator to change your role before deleting this account." (administrators, before the password check); 403 "Enter your current password to confirm deletion." | `app/api/account/delete/route.ts:32-75`; `db/schema.ts:184` |
| `/api/account/sessions` | DELETE | Any adult | All of the caller's adult sessions, this one included | `P401`, `PW403`; `R401`; GET and POST 405 | `app/api/account/sessions/route.ts:7-15` |
| `/api/account/export` | GET | Any adult | Own records (matched by owner e-mail); administrators get only their own | `P401`, `PW403`; `R401` | `app/api/account/export/route.ts:17-61` |
| `/api/student/sign-in` | POST | Anyone (public) | Own username and password; clears the adult cookie | 400 insecure origin; 429 (200 per 15 min per address); 400 "Enter your username and password."; 429 (failures: 10 per address and username, 50 per username); 401 "That username and password do not match." (also suspended); 403 approval notice | `app/api/student/sign-in/route.ts:17-56` |
| `/api/student/sign-up` | POST | Anyone (public) | New student, `approvalStatus` pending, no session | 429 (8 per hour per address); 400 for every validation error, including "That username is already taken." | `app/api/student/sign-up/route.ts:9-21`; `lib/student-auth.ts:42-63` |
| `/api/student/sign-out` | GET | Anyone (public) | This browser's student and adult sessions; 303 to `returnTo` (default `/student`) | `ORIGIN403` when cross-site | `app/api/student/sign-out/route.ts:6-11` |
| `/api/student/session` | GET | Student, also with a temporary password | Own record | `S401` (adults too) | `app/api/student/session/route.ts:5-9` |
| `/api/student/password` | POST | Student, also with a temporary password | Own account; keeps this session, ends the other student sessions | `P401`, `PW403`; `S401`; 429 (10 per 15 min per student); 400 password not 8–200 characters; 400 same as current; 403 incorrect (400 before 403) | `app/api/student/password/route.ts:7-32` |
| `/api/student/join`, `/api/classroom/*` | any | Nobody (retired) | — | 410 "Staff allocate classes. Use your student account; class-code access is retired." (after `ORIGIN403` and `JSON400`) | `proxy.ts:47` |
| `/api/health` | GET | Anyone (public) | Status and time only | 503 `{status:"degraded"}` when the database fails | `app/api/health/route.ts:10-24` |
| `/api/lms-retired` | any | Nobody | Target of the Moodle-mode rewrites | 410 `CUSTOM_LMS_RETIRED` | `app/api/lms-retired/route.ts:1-20` |

### Administration

All of these use `getStaffAccess("admin")`: `P401`/`PW403` from the proxy, then `R401` (for example a
student), then `A403` for parents and teachers (`lib/auth.ts:97-107`). The library then re-checks the
administrator inside the transaction (403), except `listUsers` (`GET /api/admin/users`) and
`listClassResults` (`GET /api/admin/results`).

| Route | Method | Who | Scope | Denials after the role check | Evidence |
| --- | --- | --- | --- | --- | --- |
| `/api/admin/users` | GET | Administrator | All adults or students (25 per page, filters), the approval queue, the latest 15 audit events | 400 "Invalid user filter." / "Invalid student filter."; 503 (no re-check inside the library) | `app/api/admin/users/route.ts:7-17`; `lib/user-management.ts:68-119` |
| `/api/admin/users` | POST | Administrator | Creates an approved parent, teacher or student with a temporary password (adults also get 8 recovery codes); never an administrator | 429 (30 per hour per administrator); 400 "Provide account details." and field errors; 403 re-check; 409 "That username is already taken." / "That email is already registered." | `app/api/admin/users/route.ts:19-33`; `lib/user-management.ts:189-218` |
| `/api/admin/users/[id]` | PATCH | Administrator | Any adult or student: name, status, role (adults), `approve`/`reject`, `revoke-sessions` | 400 field errors ("Provide the user changes.", account type, name, status, role, action); 403 re-check; 400 "Student accounts cannot be promoted to staff." (a role on a student, after the re-check); 404 "User not found."; 409 "Reactivate this account before approving or declining it.", "This request is no longer awaiting approval." (teacher request on an account that is no longer role parent), "This account is no longer awaiting approval.", "You cannot change your own role or suspend your own account.", "At least one active administrator must remain." | `app/api/admin/users/[id]/route.ts:6-19`; `lib/user-management.ts:121-183` |
| `/api/admin/users/[id]/password` | POST | Administrator | Any other account, other administrators included; any state | 429 (30 per hour); 400 "Choose an account type."; 409 "You cannot reset your own password here. Change it from My account."; 403 re-check; 404 | `app/api/admin/users/[id]/password/route.ts:8-23`; `lib/user-management.ts:230-264` |
| `/api/admin/teachers` | GET | Administrator | Active, approved teachers (not administrators) | 503 | `app/api/admin/teachers/route.ts:8-18`; `lib/class-management.ts:40-46` |
| `/api/admin/families/import` | POST | Administrator | Any class; reuses only active, approved parents (role parent) and students | 429 (20 per hour); 413 body over 256 KB; 400 "Choose a CSV file to upload." / class; 413 CSV over 64 KB; 403 re-check; 404 "Class not found."; 400 row errors (nothing created); 409 changed during upload | `app/api/admin/families/import/route.ts:12-33`; `lib/families.ts:58-191` |
| `/api/admin/family-links` | GET | Administrator | Any student's linked parents | 400 "Choose a student account."; 404 "Student not found."; 503 | `app/api/admin/family-links/route.ts:13-20`; `lib/parent-access.ts:12-26` |
| `/api/admin/family-links` | POST | Administrator | Links an active, approved parent (role parent) to an approved student, after `confirmed:true` | 400 (body, before the re-check); 403; 404 "No active parent account matches that email." / "Student not found."; 409 "Approve this student account before linking a parent." | `app/api/admin/family-links/route.ts:22-31`; `lib/parent-access.ts:28-44` |
| `/api/admin/family-links` | DELETE | Administrator | One link | 400 "Choose the family link to remove."; 404 "Parent link not found." | `app/api/admin/family-links/route.ts:33-42`; `lib/parent-access.ts:46-55` |
| `/api/admin/results` | GET | Administrator | Every class with its teacher and summary results | 503 (no re-check inside the library) | `app/api/admin/results/route.ts:7-12`; `lib/grades.ts:56-86` |

### Classes

Two styles of check are used. Routes on `getSessionAdult` answer `T403` **before** their own 401
message (for example "Sign in to manage your classes."), which is what a student gets. Routes on
`getStaffAccess("teach")` answer `R401` then `T403`. Either way a parent (including one with a pending
or rejected teacher request) gets `T403` and a student a 401 (`app/api/classes/route.ts:15-16`;
`lib/auth.ts:97-107`).

| Route | Method | Who | Scope | Denials after the role check | Evidence |
| --- | --- | --- | --- | --- | --- |
| `/api/classes` | GET | Teacher | Own classes; administrator with `?scope=all`: every class | `A403` for `?scope=all` by a teacher; 500 | `app/api/classes/route.ts:13-49` |
| `/api/classes` | POST | Teacher | Own class; an administrator may pass `teacherId` of an approved teacher | 400 "Give the class a name of 1–60 characters." (**before** the 403); 403 "Only an administrator can create a class for another teacher."; 400/404 "Choose an approved teacher." | `app/api/classes/route.ts:51-86`; `lib/class-management.ts:48-65` |
| `/api/classes/[id]` | GET | Teacher | Own class; administrator any | `C404` | `app/api/classes/[id]/route.ts:21-69` |
| `/api/classes/[id]` | PATCH | Administrator | Gives the class to another approved teacher | `R401`, `A403`; 400 "Choose an approved teacher."; 404 | `app/api/classes/[id]/route.ts:71-84`; `lib/class-management.ts:66-84` |
| `/api/classes/[id]` | DELETE | Teacher | Own class; administrator any | `C404` | `app/api/classes/[id]/route.ts:86-98` |
| `/api/classes/[id]/activities` | POST | Teacher | Own class (activity waits for approval); administrator any (approved at once) | `C404`, then 400 body; 403 "Approved staff access required." | `app/api/classes/[id]/activities/route.ts:26-76` |
| `/api/classes/[id]/activities` | PATCH | Open/close: teacher, own class. Approve/reject: administrator | Activity in the class | `C404`; 400 (**before** the 403); 403 "Only an administrator can approve or reject class activities."; 404 "Activity not found."; 409 "This activity changed. Reload it before reviewing." | `app/api/classes/[id]/activities/route.ts:77-117` |
| `/api/classes/[id]/activities` | DELETE | Teacher | Own class, any activity (also administrator-approved) | `C404`; 400; 404 | `app/api/classes/[id]/activities/route.ts:119-144` |
| `/api/classes/[id]/announcements` | POST | Teacher | Own class; visible at once (no approval) | `C404`; 400 body | `app/api/classes/[id]/announcements/route.ts:14-35` |
| `/api/classes/[id]/announcements` | DELETE | Teacher | Own class, any author | `C404`; 400; 404 "Announcement not found." | `app/api/classes/[id]/announcements/route.ts:37-69` |
| `/api/classes/[id]/attendance` | GET | Teacher | Own class, current students | 400 date (**before** `C404`); 503 | `app/api/classes/[id]/attendance/route.ts:13-21` |
| `/api/classes/[id]/attendance` | PUT | Teacher | Own class, current students only | 400 date and marks (**before** `C404`); 409 "The class list has changed since this page loaded…"; 503 | `app/api/classes/[id]/attendance/route.ts:24-35`; `lib/class-attendance.ts:77-94` |
| `/api/classes/[id]/grades` | GET | Teacher | Own class, current members; `?format=csv` | `C404` | `app/api/classes/[id]/grades/route.ts:17-68` |
| `/api/classes/[id]/sources` | GET | Teacher | Own class, every approval state | `C404`; 503 | `app/api/classes/[id]/sources/route.ts:22-30` |
| `/api/classes/[id]/sources` | POST | Teacher | Own class (waits for approval); administrator approved at once; at most 50 | 413 over 5,000 characters; 400 body; `C404`; 400 fields | `app/api/classes/[id]/sources/route.ts:33-43`; `lib/class-sources.ts:73-97` |
| `/api/classes/[id]/sources` | PATCH | Edit: teacher, own class (goes back to waiting). Approve/reject: administrator | Source in the class | 413/400 body; 404 "Source not found." for a missing `sourceId` (**before** `C404`); `C404`; 403 review; 409 stale revision | `app/api/classes/[id]/sources/route.ts:46-60`; `lib/class-sources.ts:100-137` |
| `/api/classes/[id]/sources` | DELETE | Teacher | Own class, any source | 413/400 body; `C404`; 404 | `app/api/classes/[id]/sources/route.ts:62-72` |
| `/api/classes/[id]/students` | GET | Teacher | Own roster; `?available=1` lists every active, approved student not yet in the class (50 at most) | `C404`; 503 | `app/api/classes/[id]/students/route.ts:10-19`; `lib/enrollments.ts:66-86` |
| `/api/classes/[id]/students` | POST | Teacher | Adds any active, approved student to an own class | 400 body (**before** `C404`); 404 "No active student has that username."; 409 | `app/api/classes/[id]/students/route.ts:21-33`; `lib/enrollments.ts:89-100` |
| `/api/classes/[id]/students` | DELETE | Teacher | Removes the allocation; records are kept | 400 (**before** `C404`); 404 "Active allocation not found." | `app/api/classes/[id]/students/route.ts:34-40` |
| `/api/classes/[id]/students/import` | POST | Teacher | Own class; creates approved student accounts with temporary passwords | 429 (20 per hour); 413 body over 256 KB; 400 "Choose a CSV file to upload."; 413 CSV over 64 KB (all **before** `C404`); 403 re-check; `C404`; 400 row errors (nothing created); 409 | `app/api/classes/[id]/students/import/route.ts:9-27`; `lib/enrollments.ts:151-224` |
| `/api/classes/[id]/submissions` | DELETE | Teacher | Own class; the submission must belong to it | `C404`; 400; 404 "Submission not found." | `app/api/classes/[id]/submissions/route.ts:12-33` |
| `/api/classes/[id]/topic-progress` | GET | Teacher | Own class's current students, all approved topics | `C404`; 503 | `app/api/classes/[id]/topic-progress/route.ts:9-16` |

### Content, learning records and families

| Route | Method | Who | Scope | Denials after the role check | Evidence |
| --- | --- | --- | --- | --- | --- |
| `/api/curriculum` | GET | Any signed-in account | Approved topics; a student also gets own progress; staff also get approval records | 401 "Sign in to view learning topics."; `SPW403`; 503 | `app/api/curriculum/route.ts:12-34` |
| `/api/topics` | GET, POST | Teacher | Every topic; POST makes a new topic waiting for approval | `R401`, `T403`; 413 over 400 KB; 400; 403 re-check | `app/api/topics/route.ts:7-24`; `lib/curriculum-catalog.ts:238-252` |
| `/api/topics/[id]` | GET, PUT | Teacher | Any topic; PUT adds a new version waiting for approval | `R401`, `T403`; 404; 413/400; 409 "Someone saved a newer version…" | `app/api/topics/[id]/route.ts:10-29` |
| `/api/topics/[id]` | POST | Administrator | Withdraw, restore or confirm a topic | `R401`, `A403`; 404 bad id; 413/400 body; 403 re-check; 404; 400 or 409 decision | `app/api/topics/[id]/route.ts:35-44`; `lib/curriculum-catalog.ts:329-350` |
| `/api/topics/[id]/versions/[version]` | GET | Teacher | Any version | `R401`, `T403`; 404 | `app/api/topics/[id]/versions/[version]/route.ts:19-28` |
| `/api/topics/[id]/versions/[version]` | POST | Administrator | Approve or send back a waiting version | `R401`, `A403`; 400 decision, note or confirmation (before the re-check); 409 already reviewed | `app/api/topics/[id]/versions/[version]/route.ts:31-40`; `lib/curriculum-catalog.ts:291-322` |
| `/api/studio/drafts` | GET, POST | Teacher | Own drafts; `approved-for-release` needs `canPublishContent` | `R401`, `T403`; 400; 403 "Administrator approval is required to approve a curriculum draft."; 404 "Draft not found." (another owner's draft) | `app/api/studio/drafts/route.ts:13-58` |
| `/api/studio/lessons` | GET | Teacher | Every lesson and every pending recording | `R401`, `T403`; 503 | `app/api/studio/lessons/route.ts:7-12` |
| `/api/studio/lessons/[id]` | GET | Teacher | One lesson's draft and approved versions | `R401`, `T403`; 404 | `app/api/studio/lessons/[id]/route.ts:10-17` |
| `/api/studio/lessons/[id]` | POST | Administrator | Approve or withdraw a lesson revision | `R401`, `A403`; 404 bad id; 413/400 body; 403 re-check; 409 revision changed; 400 decision or note | `app/api/studio/lessons/[id]/route.ts:20-31`; `lib/lesson-approval.ts:283-311` |
| `/api/studio/media` | POST | Teacher | Upload a recording (multipart, audio up to 12 MB, consent required); waits for approval | `R401`, `T403`; 400 | `app/api/studio/media/route.ts:13-48` |
| `/api/studio/media` | PATCH | Administrator | Approve, send back or retire any recording | `R401`, `A403`; 400 (before the re-check); 404 | `app/api/studio/media/route.ts:51-58`; `lib/lesson-approval.ts:319-342` |
| `/api/studio/media/[id]` | GET | Teacher | Any recording, pending ones included | `R401`, `T403`; 404 | `app/api/studio/media/[id]/route.ts:15-33` |
| `/api/studio/reviews` | GET, POST | Teacher | Shared checks plus own drafts; POST saves the caller's own check | `R401`, `T403`; 400 | `app/api/studio/reviews/route.ts:19-63` |
| `/api/studio/video-reviews` | POST | Administrator | Video decision for a lesson | `R401`, `A403`; 413/400 body; 403 re-check; 400 unknown lesson; 409 preview changed; 400 status fields | `app/api/studio/video-reviews/route.ts:7-16`; `lib/lesson-approval.ts:345-375` |
| `/api/audio/[lessonId]`, `/api/audio/[lessonId]/[slot]` | GET | Any signed-in account | Learners: approved lessons; staff: any lesson; always only approved, consented recordings | 404 bad lesson; `SPW403`; 404 "That lesson is not available to learners right now."; `[slot]` without a recording: 307 to the bundled clip | `app/api/audio/[lessonId]/route.ts:17-26`; `app/api/audio/[lessonId]/[slot]/route.ts:21-54` |
| `/api/narration` | POST | Any signed-in account | Topics: published only, for everyone. Activities: student own classes (approved, open); parent linked children's classes (approved, open; the child active and approved); teacher own classes, any state; administrator all | 401 "Sign in to listen to this content."; 403 temporary password; 429 (120 per minute); 413 over 2 KB; 400; 404 "This content is no longer available."; 409 content changed; 503 | `app/api/narration/route.ts:9-14`; `lib/narration-handler.ts:22-95`; `lib/narration-source.ts:22-90` |
| `/api/library` | GET | Any signed-in account; `?scope=admin`: administrator | The reader catalogue | 401 "Sign in to view the textbook library."; `SPW403`; `A403` for `?scope=admin` | `app/api/library/route.ts:29-41` |
| `/api/library` | POST, PUT, DELETE | Administrator | Add, change or reset a book | `R401`, `A403`; 413; 400; 404 | `app/api/library/route.ts:44-79` |
| `/api/profiles`, `/api/profiles/[id]` | GET | Any adult | Own home learner profiles | 401 "Sign in as a grown-up to view learner profiles." / `R401`; 404 | `app/api/profiles/route.ts:13-35`; `app/api/profiles/[id]/route.ts:13-23` |
| `/api/profiles`, `/api/profiles/[id]` | POST, PATCH, DELETE | Teacher | Own profiles | 401; `RO403`; 400; 404 "Learner profile not found."; a body that is not JSON gives 500 (gaps 14 and 15) | `app/api/profiles/route.ts:37-67`; `app/api/profiles/[id]/route.ts:25-55` |
| `/api/progress` | GET | Any adult | One own profile | `R401`; 404 | `app/api/progress/route.ts:14-23` |
| `/api/progress` | POST | Teacher | Own profile, approved lessons | `R401`; `RO403`; 400 (**before** the 404 ownership check); 404 | `app/api/progress/route.ts:25-58` |
| `/api/assignments` | GET | Any adult | Own assignments; parents see approved lessons only | `R401` | `app/api/assignments/route.ts:13-22` |
| `/api/assignments` | POST, PATCH | Teacher | Own learner profiles and assignments | `R401`; `RO403`; 400; 404 | `app/api/assignments/route.ts:24-65` |
| `/api/family`, `/api/family/sources` | GET | Parent | Linked children: their active classes, approved activities, own submissions, attendance, announcements for parents, approved sources | 401 "Parent sign in required."; 403 "Parent access required." (teachers and administrators); 503 | `app/api/family/route.ts:7-15`; `app/api/family/sources/route.ts:7-13`; `lib/parent-access.ts:57-105` |
| `/api/student/feed` | GET | Student | Own active classes, approved activities (no answers), own submissions, attendance, announcements for students, approved sources | `S401`; `SPW403`; 500 | `app/api/student/feed/route.ts:19-99` |
| `/api/student/results` | GET | Student | Own submissions on approved activities | `S401`; `SPW403` | `app/api/student/results/route.ts:8-57` |
| `/api/student/submit` | POST | Student | Approved, open activity in an own class | `S401`; `SPW403`; 429 (60 per 10 min); 400 "Choose an activity."; 404 "Activity not found."; 409 "This activity is closed."; 403 "Your teacher must allocate you to this class before you can submit."; 400 answers (**after** the 403) | `app/api/student/submit/route.ts:11-68` |
| `/api/student/topic-progress` | POST | Student | Own progress on approved topics | `S401`; `SPW403`; 400; 503 | `app/api/student/topic-progress/route.ts:8-15`; `lib/curriculum-catalog.ts:377-396` |

A method that a route file does not export answers 405 once the proxy lets the request through
(visitors get `P401` first).

## Data scoping rules

| Role | What they can reach | Where it is enforced |
| --- | --- | --- |
| **Visitor** | Public paths only: `/welcome`, `/grown-ups`, `/student`, `/safety`, sign-in, sign-up, recovery, sign-out and session APIs, `/api/health`, icons, fonts, CSS and the scripts of public pages. | `lib/learning-policy.ts:3-15`; `lib/public-assets.ts:13-41`; `proxy.ts:49,58-64` |
| **Student** | **Own record** and **own classes**: classes with an active allocation (`studentClassEnrollments`), only approved activities and sources, announcements for everyone or students, own submissions and attendance, own topic progress. Correct answers are not in the feed. | `app/api/student/feed/route.ts:19-99`; `app/api/student/results/route.ts:8-57`; `app/api/student/submit/route.ts:30-41`; `lib/class-sources.ts:56-60`; `lib/announcements.ts:13-15` |
| **Parent** | **Linked children** (`parent_student_links`, made only by an administrator) and their active classes: approved activities, the child's submissions, attendance, announcements for everyone or parents, approved sources. Own home learner profiles are read-only. No staff APIs. | `lib/parent-access.ts:57-105`; `lib/class-sources.ts:171-184`; `lib/narration-source.ts:64-90`; `app/api/assignments/route.ts:27,56` (`RO403`) |
| **Teacher** | **Own classes** (`classes.teacherId` = self) and everything in them. Another teacher's class answers 404. The student picker searches **all** active, approved students by name and username, and the teacher can allocate any of them to an own class; after that the teacher sees that student's results, attendance and topic progress. The shared topic and lesson catalogue, including drafts and pending recordings. Own learner profiles, drafts and specialist checks. | `lib/class-access.ts:12-21`; `lib/enrollments.ts:12-17,66-100`; `lib/curriculum-catalog.ts:421-436` |
| **Administrator** | **All** classes, accounts, links, results and content decisions. Own learner profiles, drafts and data export stay own-only. `GET /api/classes` without `?scope=all` shows only classes the administrator teaches. | `lib/class-access.ts:12-14`; `lib/enrollments.ts:13-14`; `app/api/classes/route.ts:20-25`; `lib/user-management.ts:68-119` |

What learners receive is limited to approved content in every learner path, for staff too:

- Topics: the latest approved version (or the shipped baseline), minus withdrawn topics
  (`lib/curriculum-catalog.ts:120-158,352-356`).
- Lessons and recordings: an approved lesson revision, and recordings that are approved and have consent
  (`lib/lesson-approval.ts:43-52,122-163,396-399`).
- Class activities and class sources: `approvalStatus` approved (`app/api/student/feed/route.ts:48`;
  `lib/parent-access.ts:75`; `lib/class-sources.ts:59`).
- Narration of a topic uses only the published version, even for staff
  (`lib/narration-source.ts:50-57`). The one exception is narration of class activities, where the
  owning teacher or an administrator can hear an unapproved or closed activity
  (`lib/narration-source.ts:64-68`).

Who drafts and who publishes is described in [CONTENT_APPROVAL.md](CONTENT_APPROVAL.md): teachers write,
administrators with `canPublishContent` approve.

## Account management rules

| Action | Who | Protections | Audited | Evidence |
| --- | --- | --- | --- | --- |
| Approve or decline an account | Administrator | Account must be active (409 otherwise). Decline only while pending; approve only when not yet approved. | `account-approved` / `account-declined` | `lib/user-management.ts:137-145,158-171` |
| Approve or reject a teacher request | Administrator | Only while the account is role parent (409). Approve: role teacher, `teacherStatus` approved (and the account approved if it was not). Reject: role parent, `teacherStatus` rejected (and declined if it was a sign-up). | `approve` / `reject` | `lib/user-management.ts:161-167` |
| Create an account | Administrator (parent, teacher or student; never administrator). Approved teachers can create students through their class CSV import. | Rate limit 30 per hour (administrators), 20 imports per hour. New accounts are approved with a temporary password. | `created`, `student-provisioned` | `lib/user-management.ts:189-218`; `lib/enrollments.ts:151-224` |
| Change a role or suspend / reactivate | Administrator | Not their own role or status (409). Demoting or suspending an active administrator is refused if no other active administrator would remain (409). Students can never get a staff role (400). The change deletes the target's sessions. | `update` | `lib/user-management.ts:133,173-179` |
| Make someone an administrator | Administrator via role change; the first administrator via `npm run admin:grant` on the server | No public route creates an administrator: sign-up only makes parents (`app/api/auth/sign-up/route.ts`), `POST /api/admin/users` refuses administrator. | `update` | `scripts/grant-admin.ts:11-19`; `lib/user-management.ts:125,153` |
| End someone's sessions | Administrator | — | `revoke-sessions` | `lib/user-management.ts:144,179` |
| Reset someone's password | Administrator, for any other account (other administrators included). The server operator can reset an administrator with `npm run admin:reset-password`. | Never their own (409). Sets a temporary password shown once, deletes the target's sessions. Rate limit 30 per hour. | `password-reset` | `lib/user-management.ts:230-264`; [HANDOVER.md](HANDOVER.md#administrator-and-role-handover) |
| Link or unlink a parent and a student | Administrator | Parent must be active, approved and role parent; student must be approved; the administrator confirms the parent's authorization. | `parent-linked` / `parent-unlinked` | `lib/parent-access.ts:28-55` |
| Import families | Administrator | All or nothing; at most 200 rows and 64 KB; reuses only active, approved accounts. | each creation, link and allocation | `lib/families.ts:58-191` |
| Delete an account | The account owner (parent or teacher), with their password | Administrators cannot delete themselves (409). Students have no self-delete; there is no administrator delete endpoint. | no | `app/api/account/delete/route.ts:32-75` |

**Audit log.** Every administrator write and most class changes insert a `user_audit_events` row with
the actor: account approvals, updates, session revocation, password resets, family links, class
allocation, class creation for a teacher, class moves and deletion, activity and source changes and
reviews, announcement removal, submission resets, student provisioning, own password changes and
teacher requests. `GET /api/admin/users` shows the latest 15 events (`lib/user-management.ts:40-42,
114-117`). Not audited: password recovery, recovery-code replacement, sign out everywhere, account
deletion, a teacher creating a class for themselves, posting an announcement, opening or closing an
activity and routine attendance saves (see [Known gaps](#known-gaps)).

**Temporary passwords.** Accounts made by an administrator or by an import, and every administrator
reset, get a temporary password shown once (responses carry `Cache-Control: no-store`,
`app/api/admin/users/route.ts:27`). The person must replace it at first sign-in. For adults, the first
change (or a recovery) also replaces the recovery codes, because the administrator saw the original
sheet (`lib/auth.ts:216-247`).

**Sessions.** A session is a random token stored hashed, in an httpOnly, SameSite Lax cookie that is
Secure in production and lasts 30 days (`lib/auth.ts:36,274-281`; `lib/student-auth.ts:19,31-39`).
Changing a password keeps the current session and ends all others; recovery ends all and starts one new
session; sign-out ends this browser's sessions; `DELETE /api/account/sessions` ends all of an adult's
sessions (`lib/auth.ts:174-177,216-247`; `lib/browser-logout.ts:9-19`).

**Recovery codes.** Adults get 8 one-time codes of 10 characters, shown once and stored hashed, at
sign-up and at administrator creation. They can be replaced with the current password. Students have no
recovery codes: an administrator resets their password (`lib/auth.ts:189-209`; `lib/password.ts:44-53`).

## Global protections

| Protection | What it does | Evidence |
| --- | --- | --- |
| Origin check on changes | Every POST, PUT, PATCH and DELETE, and every `/sign-out` request, must come from the site itself: `Sec-Fetch-Site` must be `same-origin` or `none`, a sent `Origin` must match (`PUBLIC_ORIGIN` when set), and POST/PUT/PATCH must be JSON or a same-origin multipart upload. Runs first, before sign-in, for every account state. | `proxy.ts:36-37`; `lib/request-security.ts:25-41` |
| JSON body check | A POST, PUT, PATCH or DELETE body sent as `application/json` (lower case) that does not parse to an object is refused with 400 before sign-in is checked (so a signed-out caller can get 400 rather than 401). `/api/narration` reads its own body with a 2 KB limit. Bodies up to 13 MB are accepted by the server. | `proxy.ts:39-46`; `next.config.ts:17` |
| Sign-in required | Everything not public needs an unexpired session of an active, approved account (adult cookie checked first, then student). Tokens over 100 characters and database errors count as signed out. | `proxy.ts:49-64`; `lib/learning-session.ts:13-32` |
| Temporary-password gate | Adults with an administrator-issued password reach only the change form and public paths. | `proxy.ts:53-56`; `lib/learning-policy.ts:63-66` |
| Secure sign-in | In production, sign-in and recovery from a plain-http page on another host answer 400 (the Secure cookie would be dropped). | `lib/request-security.ts:47-56` |
| Safe redirects | `returnTo` values are reduced to same-site paths; backslashes, control characters and `//` are refused. | `lib/safe-redirect.ts:19-31`; `lib/learning-policy.ts:41-52` |
| Rate limits | In-memory, per process, fixed window. By address: sign-up 5/h, recovery 5/15 min, adult sign-in 100/15 min, student sign-up 8/h, student sign-in 200/15 min. Failures only: 10 per address and account, 50 per account per 15 min (adults and students). By account: `account:<id>` 10/15 min (password, recovery codes, delete), teacher request 3/24 h, student password 10/15 min, student submit 60/10 min, narration 120/min. By administrator: create 30/h, reset 30/h, family import 20/h; student import 20/h per teacher. The address is the first `X-Forwarded-For` value; the shipped Nginx configuration overwrites that header. | `lib/rate-limit.ts:1-64`; `deploy/nginx/bangla-adventures.conf.example:81-84` |
| Retired class-code access | `/api/student/join` and `/api/classroom/*` answer 410 for everyone; `/classroom` redirects to `/student`. Staff allocate classes instead. | `proxy.ts:47-48` |
| Cache headers | Pages and API data: `private, no-store`. Public files: `public, max-age=86400`; hashed build files: a year (`private` when only signed-in pages use them); the service worker: `no-cache`. Every proxy response also gets `X-Content-Type-Options: nosniff`. Sign-out sends `Clear-Site-Data: "cache"`. | `lib/learning-policy.ts:29-39`; `proxy.ts:8-12`; `lib/browser-logout.ts:21-25` |
| Security headers | `X-Frame-Options: DENY`, HSTS, `Referrer-Policy`, `Permissions-Policy` and a CSP with `frame-ancestors`, `object-src`, `base-uri` and `form-action` on every response. | `next.config.ts` (`headers()`) |
| Cookies | `ba_adult_session` and `ba_student_session`: httpOnly, SameSite Lax, Secure in production, 30 days, token stored hashed. The `ba_language` cookie holds only the language choice. | `lib/auth.ts:274-281`; `lib/student-auth.ts:31-39`; `proxy.ts:18-25` |
| Moodle mode | With `PLATFORM_MODE=moodle` the built-in LMS pages redirect to Moodle and its APIs answer 410; the default `legacy` mode changes nothing. | `next.config.ts`; `lib/moodle-mode.ts:1-35` |

## Operational access (outside the app)

These people and keys can change the running site without using its pages. Names of servers, addresses
and server accounts are kept out of the repository on purpose
([VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#server-address-secrets)).

| Who or what | Access | Source |
| --- | --- | --- |
| **GitHub repository owner** (currently a personal account) | Full control of the repository, its Actions secrets and environments, and the published container image (a package of the owner). While the repository belongs to a personal account, only the owner can add Actions secrets. After a move to the client's organisation, an organisation administrator does this. | [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#narration-key); [DEPLOYMENT.md](DEPLOYMENT.md#automatic-deployment) |
| **Collaborators** | Write access to the code. They cannot add Actions secrets. `.github/CODEOWNERS` names a reviewer per area but does not make review mandatory. | [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#narration-key); [`.github/CODEOWNERS`](../.github/CODEOWNERS) |
| **`production` environment and its required reviewers** | Holds the deploy key and the server address and account secrets. Its required reviewers approve each deploy job and each run of the production operations workflow before it can connect to the server. | [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#going-live) steps 8–9; [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#switching-it-on) |
| **Deploy key** (`DEPLOY_SSH_KEY`) | The deployment account's SSH key. It can do anything that account can, so only reviewer-approved jobs in `production` receive it. | [DEPLOYMENT.md](DEPLOYMENT.md#automatic-deployment); [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#alerting) |
| **Status key** (`STATUS_SSH_KEY`, `production-status` environment) | A separate key for the daily status check, which needs no reviewer. The server allows it to run only the read-only `status` command (`restrict` and a forced command). It is never the deploy key, and the installer refuses one that is. | [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#setting-up-the-status-key) |
| **Server deployment account** | A dedicated, non-root account that runs the app with rootless Docker and owns the backup, monitor and off-site timers. It is used by the pipeline alone. | [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md); [DEPLOYMENT.md](DEPLOYMENT.md#automatic-deployment) |
| **Server administrator** | Administrator rights on the server itself: Nginx, certificates, the account's SSH folder permissions, anything outside the deployment account. Can write the narration key straight into the server `.env` and can remove the status key by hand. | [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#going-live); [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#replacing-or-removing-the-status-key) |
| **Server operator commands** | `npm run admin:grant -- EMAIL` makes an existing registered account an approved administrator; `npm run admin:reset-password -- EMAIL` gives an account a temporary password. Both run against the app's database on the server, so only someone with server access can use them. | [DEPLOYMENT.md](DEPLOYMENT.md#first-administrator-and-recovery); [HANDOVER.md](HANDOVER.md#administrator-and-role-handover) |
| **ElevenLabs key owner** | The client owns the ElevenLabs account and key. The repository owner stores it as the `ELEVENLABS_API_KEY` secret of `production`, or the server administrator writes it into the server `.env`. The client rotates it after handover. It never reaches browsers. | [HANDOVER.md](HANDOVER.md#deployment-and-ownership); [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md#narration-key) |
| **Backup key custodian** | The off-site backup repository password must be kept by the client, away from the server. Who holds it, the destination and the retention are still to be agreed with the client. | [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#off-site-copies); [DEPLOYMENT.md](DEPLOYMENT.md#backups-and-existing-data) |
| **Status alert recipient** | GitHub e-mails the owner of the daily status schedule when the check fails. | [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md#alerting) |

## Known gaps

These were found in the code and, where marked, confirmed by the behavioural probe or the independent
re-check. Apart from gap 4 (a teacher can pull any student into an own class, by design), none of them
lets a person read or change another class's, family's or account's data: every cross-scope request
(another teacher's class, an unlinked child, another student's class or results) answered 404 or 403, or
returned only the caller's own records. They are listed so they can be fixed or accepted on purpose.
Application code was not changed.

### Medium

| # | Gap | Evidence | Suggested fix |
| --- | --- | --- | --- |
| 1 | **A student can raise their own score.** `POST /api/student/submit` returns the correct answer to every question and overwrites the previous submission, so while an activity is open a student can submit anything, read the answers and resubmit for full marks (60 tries per 10 minutes). Teachers and parents then see the raised score. Confirmed by the re-check (0/2, then 2/2 with the returned answers). | `app/api/student/submit/route.ts:43-62` | Return only right/wrong while the activity is open, or keep the first (or best) attempt and let the teacher reset it. |
| 2 | **Topic quiz answers reach the browser.** `GET /api/curriculum` sends each approved topic whole, quiz answers included, so the server-side marking of topic quizzes can be bypassed. Confirmed by the re-check (`quiz[].answer` in a student's response). | `app/api/curriculum/route.ts:27-28` | Remove the answer fields from the response and keep marking on the server. |
| 3 | **A teacher deleting their own account deletes their classes.** `classes.teacher_id` cascades on delete, and `POST /api/account/delete` blocks only administrators. Classes an administrator allocated, with their activities and submissions, go with the teacher. Confirmed by the probe. | `db/schema.ts:184`; `app/api/account/delete/route.ts:40` | Refuse deletion while the teacher still has classes (ask an administrator to move them first), as is done for administrators. |
| 4 | **Teachers reach every student, not only their own.** The class picker lists every active, approved student system-wide, and a teacher can allocate any of them to an own class without the other teacher, a parent or an administrator. After that the teacher sees the student's results, attendance and topic progress. Confirmed by the probe (a teacher added another class's student). The code documents this as intended. | `lib/enrollments.ts:66-100`; `lib/curriculum-catalog.ts:421-436` | Decide explicitly. If not wanted, limit the picker to unallocated students, or make allocation an administrator action. |
| 5 | **Teachers can create approved student accounts.** The class CSV import creates students that skip the administrator approval queue (self sign-ups must wait). Confirmed by the probe. | `lib/enrollments.ts:208`; `db/schema.ts:221` | Decide explicitly; if not wanted, create them as pending or make the import administrator-only. |
| 6 | **Announcements are not reviewed or audited.** A teacher's announcement reaches students and parents at once, and posting it writes no audit row, unlike activities and sources. | `app/api/classes/[id]/announcements/route.ts:26-31` | At least audit posting; consider the same approval step as activities. |
| 7 | **Per-address rate limits trust the client's `X-Forwarded-For`.** The key is the first value of that header. Against the app port the probe bypassed the per-address limits on sign-up, sign-in, recovery and student sign-up by changing it; the per-account limits held. The shipped Nginx file overwrites the header, so this matters only if the app port is reachable directly or another proxy appends to the header. Recovery has no per-account limit. The store is per process and is lost on restart. | `lib/rate-limit.ts:53-57`; `app/api/auth/recover/route.ts:20`; `deploy/nginx/bangla-adventures.conf.example:84` | Keep the app port private, trust the header only from the known proxy, and add a per-account limit to recovery. |
| 8 | **Bundled lesson clips skip the lesson approval check.** `/api/audio/[lessonId]/[slot]` checks approval and then redirects to `/audio/lesson-<id>-<slot>.ogg`, but those static files are served to any signed-in account directly, so clips of withdrawn or unapproved lessons are reachable by URL. Confirmed by the re-check (200 for a student, 401 signed out). | `app/api/audio/[lessonId]/[slot]/route.ts:53`; `proxy.ts:51,57` | Serve bundled clips through the approved route, or block `/audio/lesson-*` in the proxy for learners. |
| 9 | **Role changes during approve or reject skip the `teacherStatus` fix-up.** `PATCH /api/admin/users/[id]` with `action:"approve", role:"teacher"` on a parent sign-up gives role teacher with `teacherStatus` none (cannot teach, home `/family`). A pending or declined account can be given role admin, and the last-administrator count ignores `approvalStatus`. The no-self-change rule means an acting administrator always remains, so the 409 "At least one active administrator must remain." cannot be triggered through the API (probe). | `lib/user-management.ts:153,168-177` | Reject a `role` field together with `action`, and count only approved administrators. |

### Low

| # | Gap | Evidence | Suggested fix |
| --- | --- | --- | --- |
| 10 | Account deletion is not one transaction: media files are removed first, then several separate deletes run, so a failure leaves a partly deleted account. | `app/api/account/delete/route.ts:54-70` | Run the database deletes in one transaction and remove files after it commits. |
| 11 | Sessions cannot be listed or ended one at a time; students have no "sign out everywhere". Signing in on top of an existing session only clears the other cookie, and the old session stays valid until it expires. | `app/api/account/sessions/route.ts:7-15`; `app/api/auth/sign-in/route.ts:58`; `app/api/student/sign-in/route.ts:54` | Add a session list with per-session revoke for adults and students, and delete the replaced session at sign-in. |
| 12 | The data export covers only rows keyed by the owner's e-mail: classes taught, family links, attendance and audit events are missing. Students have no export. | `app/api/account/export/route.ts:39-52` | Extend the export, and add one for students (or an administrator export per student). |
| 13 | Account existence can be learned: student sign-in answers faster for unknown or suspended usernames (no hash), student sign-up says a username is taken (confirmed by the re-check), adult sign-up answers 409 for a known e-mail. All are rate-limited per address. | `lib/student-auth.ts:56,70`; `lib/auth.ts:38,145`; `app/api/auth/sign-up/route.ts:41` | Verify against a dummy hash for students, as for adults. |
| 14 | Unhandled 500s on the wrong body type (authorization still runs first): `POST`/`PATCH /api/assignments` and `POST /api/studio/media` (confirmed by the probe), and `POST /api/studio/reviews`, `POST /api/progress` (confirmed by the re-check), `PATCH /api/profiles/[id]`. The proxy's JSON check only looks at a `Content-Type` that starts with lower-case `application/json`, while the origin check accepts any letter case, so `Application/JSON` with a malformed body also reaches these routes unparsed. Two simultaneous student sign-ups with one username also give 500. `/api/student/sign-out` has no error handling, so a database error leaves both cookies set. | `app/api/assignments/route.ts:28,57`; `app/api/studio/media/route.ts:17`; `lib/student-auth.ts:55-61`; `app/api/student/sign-out/route.ts:9` | Catch body parsing and answer 400; use `onConflictDoNothing` for student sign-up; wrap student sign-out as the adult one is. |
| 15 | Some 500 responses include raw error messages: class routes, student feed, results and submit, `GET /api/studio/reviews`, and `POST /api/profiles`, which answers a non-JSON body with the parser's message (confirmed by the re-check). | `app/api/classes/route.ts:88-95`; `app/api/student/feed/route.ts:110-114`; `app/api/studio/reviews/route.ts:35-37`; `app/api/profiles/route.ts:43,78-82` | Log the detail on the server and answer a fixed message. |
| 16 | Not audited: password recovery, recovery-code replacement, sign out everywhere, account deletion, a teacher creating a class for themselves (confirmed by the re-check), announcement posting, opening or closing an activity, attendance saves. | `lib/auth.ts:237-247`; `app/api/account/recovery-codes/route.ts:23`; `app/api/account/sessions/route.ts:11`; `app/api/account/delete/route.ts:62-70`; `app/api/classes/route.ts:72-76` | Add audit rows for the account events at least. |
| 17 | Teachers can delete any announcement, activity or source in their own class, including ones an administrator wrote or approved. | `app/api/classes/[id]/announcements/route.ts:52-57`; `app/api/classes/[id]/activities/route.ts:135`; `lib/class-sources.ts:144` | Decide whether administrator content should be protected. |
| 18 | Parent views ignore the child's account state: a suspended child's records stay visible on `/api/family`. An administrator can link a parent to a suspended (approved) student. Confirmed by the re-check (the suspended child's class and result stayed on `/api/family`). | `lib/parent-access.ts:35-38,62-71` | Filter on student `status` in both places. |
| 19 | When a teacher is demoted or suspended, their classes keep pointing to them and only an administrator can open them until someone moves them. | `lib/class-access.ts:12-14`; `lib/class-management.ts:66-84` | Show such classes on `/admin/classes` as needing a new teacher. |
| 20 | An administrator who resets another administrator's password sees the temporary password and could sign in as them first. Only the `password-reset` audit row records it. This is by design. | `lib/user-management.ts:249-263` | Accept, or require the operator command for administrator resets. |
| 21 | Without `PUBLIC_ORIGIN`, a request that claims `Sec-Fetch-Site: same-origin` passes the origin check even with a foreign `Origin`. Browsers set that header themselves, so a web page cannot exploit it; non-browser clients can. Confirmed by the probe. | `lib/request-security.ts:32` | Set `PUBLIC_ORIGIN` in production (already a go-live step). |
| 22 | Defence-in-depth gaps: `GET /api/admin/users`, `/api/admin/results` and the library writes have no in-transaction administrator re-check; `/api/audio/*` relies only on the proxy for sign-in; `lib/enrollments.ts` re-checks only `canTeach`; the student results and submit routes do not check that the roster row belongs to the enrolled class. | `lib/user-management.ts:68-119`; `lib/grades.ts:56-86`; `lib/library-catalog.ts:138-238`; `app/api/audio/[lessonId]/route.ts:20-24`; `lib/enrollments.ts:13-14`; `app/api/student/results/route.ts:14-19` | Add the same re-checks as the other administrator and class functions. |
| 23 | The proxy treats any path ending in `.<ext>` as a file: such paths skip the temporary-password gate (routes still block) and a signed-out page request with a dot gets 401 JSON instead of a sign-in redirect. Confirmed by the re-check (`/api/profiles/x.json` gave a temporary-password adult the route's 401 instead of `PW403`). | `proxy.ts:51,58-60` | Match only `/_next/` and known public file extensions. |
| 24 | The retired `/api/classroom/{feed,submit,join}` and `/api/student/join` handlers are unreachable dead code; feed and submit still trust the old class token. | `proxy.ts:47`; `lib/classroom-server.ts:17-40` | Delete them, and the unrendered `app/classroom/page.tsx`. |
| 25 | The proxy parses JSON bodies up to 13 MB before the routes' own size limits apply. | `proxy.ts:43`; `next.config.ts:17` | Check `Content-Length` in the proxy before parsing. |
| 26 | One staff account can use up the whole site's daily narration allowance (`ELEVENLABS_DAILY_CHARACTER_LIMIT`, 20,000 characters by default, shared by everyone). A teacher can narrate their own unapproved activities, whose text they write freely, at 120 requests a minute, after which every reader gets 429 for new narration until the next day. Read in the code only; the re-check had no narration key. | `lib/narration-source.ts:64`; `lib/narration-handler.ts:69`; `lib/generated-narration.ts:117-131,163` | Give each account its own daily share, and narrate unapproved activities only from saved audio or not at all. |

### Informational

| # | Note | Evidence |
| --- | --- | --- |
| 27 | Non-admins are sent to `/family` from `/admin/classes`, but to their home (`/teach` for teachers) from `/admin/results` and `/admin/sources`; `/admin` shows a panel instead. | `app/admin/classes/page.tsx:8`; `app/admin/results/page.tsx:9`; `app/admin/page.tsx:11` |
| 28 | An adult with a temporary password sees the student sign-in form on `/student`, and the sign-in form on `/grown-ups?switchAccount=1`, instead of being sent to the password form (probe). Their APIs stay blocked. | `app/student/page.tsx:27-30`; `app/grown-ups/page.tsx:24-25` |
| 29 | "Approved for release" on a curriculum draft is only a label: no learner path reads drafts. Specialist checks take a free-typed reviewer name and are display-only. | `app/api/studio/drafts/route.ts:18,50`; `app/api/studio/reviews/route.ts:49-53` |
| 30 | `/books` describes an "educator evidence room", but any signed-in account can open it; the links are public documents. The worksheet pages link "Grown-up dashboard" for students too. | `app/books/page.tsx:224-263`; `app/worksheets/page.tsx:41` |
| 31 | `PATCH /api/profiles/[id]` accepts any `ageBand` of up to 20 characters, while POST limits it to the allowed set. `getSessionStudent` does not cap token length (the proxy already does). | `app/api/profiles/[id]/route.ts:37`; `lib/student-auth.ts:86-87` |

## How this was verified

**Code mapping.** Every route file under `app/api`, every page under `app`, `proxy.ts` and the
access libraries in `lib/` were read and each rule recorded with its `file:line`, for six personas
(visitor, student, parent, pending teacher applicant, teacher, administrator) and every account state.

**Behavioural probe.** On 6 November 2026 a fresh production build of commit `c4cb7ae` was started on a
local port with an empty temporary database. Accounts were created through the app's own APIs
(sign-up, administrator approval, temporary passwords, class allocation, family link). The probe used
12 personas: visitor, pending parent, suspended teacher (stale cookie), student, a second student in
another class, a student with a temporary password, parent, parent with a pending teacher request, two
teachers with separate classes, the first administrator, and a second administrator signed in with a
temporary password, plus throwaway accounts for destructive checks (self-delete, suspension, expiry,
decline, recovery, the 3-per-day teacher request limit). It sent **2,014 route × persona requests** in
337 probes over 199 distinct method and URL combinations, with a same-origin `Origin` header and
redirects not followed.

Results matched the mapping except where this document now states what actually happens:

- `/student` does not send an adult with a temporary password to the password form, and `/grown-ups`
  does not with `?switchAccount=1` ([Page access](#page-access) notes, gap 28).
- `POST /api/studio/media` with a JSON or malformed multipart body answers 500, not 400 (gap 14).
- The "last active administrator" 409 cannot be reached through the API (gap 9).
- Paths with a trailing slash get a 308 to the path without it before the proxy runs, so the
  trailing-slash handling in `lib/learning-policy.ts:11,64` never applies.
- The insecure-origin 400 on sign-in appears only for a plain-http page on the site's own host; a
  foreign origin gets the proxy's 403 first, and no `Origin` skips the check.

**Independent re-check.** The same day every row of the tables above was compared with the code again by
someone who had not written them, and a second fresh production build with an empty database was
started on another local port. Personas were again created through the app's APIs (administrator via
`npm run admin:grant`, teachers, parents and students with temporary passwords, two classes, a family
link, an approved activity). It reproduced gaps 1, 2, 3, 4, 5, 7 (per-address sign-up limit bypassed by
changing `X-Forwarded-For`), 8, 9, 13, 14, 15, 16, 18, 21 and 23, and found these corrections, now in
the tables: a parent hears narration of an activity only while it is open; `GET /api/admin/users` has
no in-transaction re-check; several denial orders (family and student imports, user updates, topic and
lesson decisions, video checks). It also repeated the cross-scope checks: another teacher's class answered
404 on every class route, an unlinked parent saw no children, and a student outside the class got 403
on submit and 404 on narration.

Not exercised by the probe: Moodle mode (it is fixed at build time), the in-browser session recheck,
database-failure branches, several rate limits at their full count (sign-in per address, student sign-in
per address, administrator create and reset, imports, submit, narration), real narration audio, the
family CSV success path and the 413 size limits, a configured `PUBLIC_ORIGIN`, and HEAD or OPTIONS
requests.

**Automated tests that cover access.** Run with `npm test`, `npm run test:integration` and
`npm run test:e2e`:

- Unit: [`tests/roles.test.mjs`](../tests/roles.test.mjs),
  [`tests/request-security.test.mjs`](../tests/request-security.test.mjs),
  [`tests/learning-access.test.mjs`](../tests/learning-access.test.mjs),
  [`tests/learning-session.test.mjs`](../tests/learning-session.test.mjs),
  [`tests/safe-redirect.test.mjs`](../tests/safe-redirect.test.mjs),
  [`tests/rate-limit.test.mjs`](../tests/rate-limit.test.mjs),
  [`tests/password.test.mjs`](../tests/password.test.mjs),
  [`tests/user-management.test.mjs`](../tests/user-management.test.mjs),
  [`tests/account-approval.test.mjs`](../tests/account-approval.test.mjs),
  [`tests/class-access.test.mjs`](../tests/class-access.test.mjs),
  [`tests/parent-access.test.mjs`](../tests/parent-access.test.mjs),
  [`tests/admin-content-approval.test.mjs`](../tests/admin-content-approval.test.mjs),
  [`tests/access-migration.test.mjs`](../tests/access-migration.test.mjs),
  [`tests/reset-password.test.mjs`](../tests/reset-password.test.mjs).
- Integration (a running server): [`tests/integration/rbac-flow.test.mjs`](../tests/integration/rbac-flow.test.mjs),
  [`tests/integration/api-flow.test.mjs`](../tests/integration/api-flow.test.mjs),
  [`tests/integration/account-approval-flow.test.mjs`](../tests/integration/account-approval-flow.test.mjs),
  [`tests/integration/password-change-flow.test.mjs`](../tests/integration/password-change-flow.test.mjs),
  [`tests/integration/public-origin-flow.test.mjs`](../tests/integration/public-origin-flow.test.mjs),
  [`tests/integration/class-content-approval.test.mjs`](../tests/integration/class-content-approval.test.mjs),
  [`tests/integration/serving-flow.test.mjs`](../tests/integration/serving-flow.test.mjs).
- Browser: [`tests/e2e/access.spec.ts`](../tests/e2e/access.spec.ts),
  [`tests/e2e/accounts.spec.ts`](../tests/e2e/accounts.spec.ts),
  [`tests/e2e/families.spec.ts`](../tests/e2e/families.spec.ts),
  [`tests/e2e/admin-classes.spec.ts`](../tests/e2e/admin-classes.spec.ts),
  [`tests/e2e/public-pages.spec.ts`](../tests/e2e/public-pages.spec.ts).

The gaps above are not covered by tests yet; a fix for any of them should add one.
