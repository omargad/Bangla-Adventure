# Release acceptance and review record

Use this record for a specific custom-application release. Assign the roles below
to actual people before sign-off; role labels are not reviewer identities. Store
private participant details, consent forms and credentials in the client's
approved restricted location, then reference that evidence here by identifier.
Do not copy them into GitHub.

No human approval is asserted by this template. Existing draft notices,
educational-review statuses and publication gates stay in place. The optional
Moodle pilot has its own manifest/release checks; this record does not override
them or make that pilot a dependency of the custom app.

## Release identity

| Field | Value to record |
| --- | --- |
| Repository | https://github.com/omargad/Bangla-Adventure |
| Commit/release | Pending: exact tested commit and release URL |
| Environment and public origin | Pending: staging/production identifier and HTTPS origin |
| Application mode | `legacy` for the current custom application |
| Client release owner | Pending: confirmed person and approved contact channel |
| Technical operator/support owner | Pending: confirmed person and escalation channel |
| Intended cohort and content scope | Pending: age/context, module/content versions and access limits |
| Review date and decision | Pending: date, accept/reject/restricted-pilot decision and conditions |

## Evidence ledger

Each row starts pending until its responsible reviewer provides dated evidence.
Record the reviewer name, evidence reference, result, restrictions and expiry or
next review date. If a check fails, link its issue and retain the restriction.

| Area | Responsible role | Required evidence | Status / reviewer / reference |
| --- | --- | --- | --- |
| Software release | Technical release owner | Clean installation; build, typecheck, lint, unit, API and browser results for the exact commit; failures explained | Pending / unassigned / none recorded |
| Container option, if used | Deployment operator | Image build and fresh-volume persistence smoke result; actual host readiness and volume ownership | Pending / unassigned / none recorded |
| Roles and account recovery | QA reviewer + client administrator | Role journeys below; teacher approval; family isolation; one-time recovery code demonstration with synthetic test accounts | Pending / unassigned / none recorded |
| Hosting and HTTPS | Deployment operator | Approved hosting ownership, external HTTPS/readiness, certificate-renewal validation, disk/certificate/backup-age alerts | Pending / unassigned / none recorded |
| Data recovery | Backup operator + client data owner | Correct live paths; verified backup; approved encrypted off-server copy and key custody; isolated restore drill and recovery time | Pending / unassigned / none recorded |
| Bangla accuracy | Bangla educator/editor | Line-level language, pronunciation and translation review for each in-scope content revision | Pending / unassigned / none recorded |
| English adaptation and age suitability | Diaspora educator | Reading level, context, scaffolding and learning outcomes reviewed for the declared cohort | Pending / unassigned / none recorded |
| Historical/cultural accuracy and sources | Subject/community reviewer | Claims checked against cited sources; contested framing and attribution resolved | Pending / unassigned / none recorded |
| Media and rights | Media/rights reviewer | Exact asset/source, permitted use, attribution and any necessary consent; video existence, captions and suitability checked | Pending / unassigned / none recorded |
| Accessibility | Accessibility reviewer | Keyboard, focus, labels, screen-reader, contrast and zoom/reflow findings on the in-scope journeys; unresolved issues recorded | Pending / unassigned / none recorded |
| Privacy and safeguarding | Client privacy/safeguarding lead | Approved data purpose/access/retention/deletion, incident process, child-pilot arrangements and evidence handling | Pending / unassigned / none recorded |
| Consented usability pilot | Client pilot coordinator | Approved participant/guardian process, observed tasks, anonymized findings, fixes and remaining restrictions | Pending / unassigned / none recorded |
| Client handover | Client release owner | Administrator access, operational guides, support contact and acceptance/known-issues record acknowledged | Pending / unassigned / none recorded |

## Role journeys

Run destructive or exploratory tests only with synthetic users and an isolated
database. Production smoke checks must use explicitly authorized test accounts
and preserve real records.

1. **Administrator:** register the confirmed test owner, grant admin on the same
   database, sign in again, approve a teacher, manage student/family links and
   edit a topic in Topics. Verify students keep the approved version
   until the edit is previewed in English and Bangla and approved. In Sources,
   replace one book's yearly NCTB link (per class where a book covers several),
   note the warning for an address outside nctb.gov.bd, and confirm students'
   Sources & references and the topic sources open the new link.
2. **Teacher:** request access, demonstrate no teaching privileges before approval,
   create a class and activity/quiz, allocate an exact registered student, inspect
   submissions/results, and post an announcement visible only to that class. Write
   a new topic, confirm students cannot see it, then preview and approve it. In
   Lessons, preview a lesson in Bangla, withdraw it with a reason, confirm the
   student lesson list and its link no longer show it, then open every part of
   the lesson and approve it again. In Class sources, add a link for one class and
   confirm only that class's students (and their linked parents) see it; the
   shared NCTB links cannot be changed from a teacher account.
3. **Student:** sign in to My Learning, open Learning topics and sources, complete
   an allocated activity, view results/progress, refresh and switch devices. Confirm
   unallocated class data is unavailable and no self-enrolment code is required.
4. **Parent:** link an exact registered account through admin controls; confirm it
   sees only the linked student's academic records, cannot submit as the child or
   edit grades, and loses access when the link is removed without losing records.
5. **Session/recovery:** demonstrate one-time recovery codes, role change/session
   invalidation and logout/account switching. Confirm a stale tab does not retain
   another user's portal or private cached content. Do not record recovery secrets.
6. **Accessibility/responsiveness:** cover the same journeys at desktop/tablet/mobile
   widths, with keyboard only, visible focus, screen-reader labels and zoom/reflow.

## Media review and optional improvements

Use [`MEDIA_REVIEW.md`](MEDIA_REVIEW.md) for candidate video and human-audio
evidence. Existing synthetic audio fallback does not prove pronunciation review.
Human recordings are an enhancement when reviewed recordings and consent are
available. Unverified videos are not approved merely because their URLs resolve.

Email-based password reset is not part of this release's recovery contract. The
supported mechanism is recovery codes. Adding email delivery is a separately
scoped feature with provider configuration, abuse controls and verification tests;
do not mark it working because an email address exists on an account.

## Sign-off rule

The client release owner records a decision for the declared scope only after
the applicable evidence is present. Record non-applicable rows with a reason and
owner, not a fabricated pass. A restricted pilot must state its allowed cohort,
content, duration, support and unresolved issues. Re-review changed content and
material access/data-flow changes before extending previous approval.
