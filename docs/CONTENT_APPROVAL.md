# Admin approval before publication

Teachers create and submit learning content. An active, approved administrator
decides whether it can be published to students and parents. Teacher account
approval alone does not grant content publication authority. Only administrators
approve content; nobody approves their own work, because an administrator's own
work does not wait for approval at all (see below).

| Content | Teacher action | Admin action | Learner access |
| --- | --- | --- | --- |
| Shared topics | Create or edit a pending version; preview and read feedback. While **Teachers' topics need an administrator's approval** is off, a teacher's save is published at once | Approve the exact version, send back with a note, withdraw or restore; the Admin's own new topics and edits are published as they are saved; turn the switch on or off | Latest approved version only; pending edits do not replace it |
| Shipped lessons | Preview the exact candidate, including Bangla instructions and practice models | Approve the reviewed fingerprint, withdraw or restore | Stored approved revision only; a source-code change cannot publish itself |
| Uploaded recordings | Upload with consent; preview pending recordings | Listen and approve, send back or retire; the Admin's own upload is approved as it is uploaded | Approved recordings with recorded consent only |
| Lesson video | Preview candidate media | Save the separate video decision or replacement | Fresh installations require an explicit Admin media decision; text approval does not approve a video |
| Class activities | Submit to own class; close, reopen or delete; revise rejected work as a new activity | Preview instructions, questions and answers; approve or send back; the Admin's own activities are approved as they are added | Approved activities only; only open approved activities accept submissions |
| Class learning resources | Submit links for own class; edit or remove | Review the current revision; approve or send back; the Admin's own links are approved as they are added or edited | Approved resources only; a teacher edit resets approval |

Administrators review topics at `/teach/topics`, lessons and recordings at
`/studio`, and class content at `/teach` under **All classes**. Open a class and
select **Activities & quizzes** or **Class sources**. Class review requests carry
the revision shown to the reviewer; a concurrent change makes an older review
request fail instead of approving unseen changes.

## Who approves what

Only an active, approved administrator without a temporary password publishes
directly (`canPublishContent` in `lib/roles.ts`, checked again inside each save).
Anyone else's work waits, whatever the settings say.

- **An administrator's own work publishes at once.** A topic an administrator
  creates or edits becomes the approved version as it is saved, and a lesson
  recording an administrator uploads (with the speaker's consent ticked) is
  approved as it is uploaded, replacing the slot's previous recording. Class
  activities and class sources an administrator adds are approved as they are
  added. Each is recorded under that administrator: `topic-version-approved` with
  `{ self: true }` and `lesson-audio-approved` with `{ self: true }` in the audit
  log (shown in **Recent changes** as "Topic approved" and "Lesson recording
  approved"), and the class records carry the administrator as the reviewer.
- **Teachers' topics: a switch.** On the Topics page an administrator sees
  **Who needs approval** with the switch **Teachers' topics need an
  administrator's approval**. It is **on** by default, and an installation where
  nobody has changed it (including every installation from before the switch) is
  on. While it is on, a teacher's new topic or edit waits for an administrator. While
  it is off, it is published as the teacher saves it and recorded as
  `topic-version-approved` with `{ automatic: true, setting:
  "teacher-topics-need-approval" }` under the teacher, with no administrator named
  as the reviewer; the version history says "Published at once (teachers' topics
  did not need approval)". Turning the switch off publishes nothing that is already
  waiting: those versions stay in **Waiting for approval** until an administrator
  approves or sends them back, and the page says so. A teacher's edit of a topic
  an administrator withdrew always waits, because only an administrator shows a
  withdrawn topic again. Every change of the switch is audited as
  `approval-setting-changed` ("Approval setting changed" in **Recent changes**)
  with the old and new value. The switch changes only through
  `PUT /api/admin/approval-settings`, which refuses anyone but such an
  administrator.
- **An edit over a waiting version.** The editor always starts from the newest
  version, so an administrator who edits a topic with a teacher's edit still
  waiting builds on that edit. Saving publishes the administrator's version, which
  includes the teacher's changes, and marks the waiting version **Replaced by a
  newer version** (superseded), as approving a later version always has. The
  editor says this before saving, and the audit entry lists the superseded
  versions. A stale editor is still refused, so nobody overwrites unseen work.
  The same applies to a teacher's edit saved while the switch is off: it builds on
  the waiting version and is published with it.
  An administrator's edit of a withdrawn topic shows it to students again, as
  approving a new version of it does.

The setting covers topics only. Lessons, recordings, videos, class activities and
class sources from teachers always wait for an administrator.

Routine announcements, student allocation, attendance and marks remain class
management actions. They do not require content approval. Internal specialist
notes are not a publication decision. Account deletion and removal of owned
resources retain their existing privacy and removal behavior.

## Existing records

The idempotent migration preserves content, review history and submissions. It
does not fabricate Admin approvals. It adds the `app_settings` table and the
`topic_versions.published_directly` column without writing any setting, so an
upgraded installation keeps teachers' topics waiting until an administrator turns
the switch off. Existing class activities and resources enter
the review queue because the old schema did not record an Admin publication
decision. Teacher-approved shared content without an Admin decision is held for
review. Existing shipped baseline topics and fixed lessons remain identified as
baselines, not individually reviewed content. Legacy video checks without a
matching recorded Admin decision do not change learner playback until an Admin
records a new decision.

Shipped topic and lesson content is now stored as immutable revisions. On an
existing installation, the previous release's baseline content is frozen; a
changed bundled source enters the pending queue while its previously available
version stays available, subject to withdrawals and earlier Admin decisions.
Existing custom approved topics retain their own content. On a fresh database,
all 15 shipped topics and 18 lessons start pending, with no invented baseline
approval. Admins must review and approve each item before learner use.

A lesson revision includes its English content, Bangla instructional copy,
extension exercises and written practice models. The Studio sends the exact
preview fingerprint when approving; stale previews are refused. Historical
English-only approved lessons do not borrow newer unapproved Bangla copy.
Worksheets use the same approved snapshot as the learner lesson. Topics retain
canonical answer indices even when the reader changes their presentation order.

Primary videos, playlists and alternatives remain separate from text review.
Unchanged videos already available on an upgraded installation retain legacy
availability; this is not a new suitability review. Fresh installations show no
primary video until an Admin records a media decision. Withheld video URLs and
unreviewed playlist/alternative metadata are omitted from learner payloads.
Teacher Studio previews remain available for review. Native pronunciation,
caption accuracy, age suitability and exact NCTB edition/page references still
require actual educator/media review; a migration or successful test supplies
none of those approvals.

Video review submissions carry the viewed candidate's video ID and content
fingerprint. An outdated preview must be reopened before a decision can be
saved. Decisions for a new candidate video do not overwrite the decision for
the older video that learners may still be using.

This means previously visible teacher content may disappear from learner views
until reviewed; its stored data and results are retained for staff. Narration
must resolve published content and bind its cache to that approved revision.
Changing an unapproved candidate must not generate learner audio for it.
