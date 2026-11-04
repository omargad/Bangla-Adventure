# Complete the existing browser-created demo

`scripts/reconcile-demo.ts` is an operator command for the **existing** Demo Class,
not a general seed. It adds missing synthetic work for Maya, Arif, Nadia, Rafi and
Zara and missing pending applicants. It does not modify any existing record,
including Camel's work, passwords, sessions, attendance, family links, activities,
announcements, approvals or sources. The crafts showcase remains untouched.

Run a read-only preflight against the mounted database first:

```sh
DATABASE_PATH=/app/.data/bangla-adventures.db node --import tsx scripts/reconcile-demo.ts
```

Review the returned additions, then explicitly apply:

```sh
DATABASE_PATH=/app/.data/bangla-adventures.db node --import tsx scripts/reconcile-demo.ts --apply
```

The database must exist, and its class ID, account names and roles, six-student
roster, four activity titles and every quiz question must match the reviewed
browser demo. A mismatch stops without writing. Apply makes a SQLite backup with
mode `0600`, validates again under a write lock, and inserts the additions and a
durable run marker in one transaction. Retain the returned backup path. A rerun
returns `already-applied`, preserving later student work, teacher resets and admin
approvals. No application endpoint invokes this script; never add it to normal
startup or migrations.

New applicant fixtures are Laila Rahman (teacher request), Nusrat Khan (parent),
and Samira Khan (student), labelled Demo. They remain pending. Their random
passwords are discarded, so an administrator must issue a temporary password
through the normal recovery flow if a demonstration later needs to sign in as
one of them. A matching existing signup is preserved, including its credentials
and approval status. No login credentials are printed or stored in this guide.

Verify in the app after applying:

- Tim's class has six students with varied work; Arif and Rafi each retain one
  unfinished revision activity, and nobody is given a new showcase submission.
- Camel still has his original three class results and topic progress.
- Frank sees the same Camel-only family records.
- Admin's queue includes newly created pending applicants, unless an applicant
  already existed and had been handled before the command ran.

The audit event identifies these records as synthetic demo data. It is not an
educational assessment of real learners, and the command does not certify lesson,
video or audio review.
