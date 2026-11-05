# Admin approval before publication

Teachers create and submit learning content. An active, approved administrator
decides whether it can be published to students and parents. Teacher account
approval alone does not grant content publication authority.

| Content | Teacher action | Admin action | Learner access |
| --- | --- | --- | --- |
| Shared topics | Create or edit a pending version; preview and read feedback | Approve the exact version, send back with a note, withdraw or restore | Latest approved version only; pending edits do not replace it |
| Fixed lessons | Preview the lesson and its review history | Approve, withdraw or restore | Approved lessons only |
| Uploaded recordings | Upload with consent; preview pending recordings | Listen and approve, send back or retire | Approved recordings with recorded consent only |
| Lesson video | View video and review information | Save the effective video decision or replacement | Only explicit Admin video decisions alter the shipped video |
| Class activities | Submit to own class; close, reopen or delete; revise rejected work as a new activity | Preview instructions, questions and answers; approve or send back | Approved activities only; only open approved activities accept submissions |
| Class learning resources | Submit links for own class; edit or remove | Review the current revision; approve or send back | Approved resources only; a teacher edit resets approval |

Administrators review topics at `/teach/topics`, lessons and recordings at
`/studio`, and class content at `/teach` under **All classes**. Open a class and
select **Activities & quizzes** or **Class sources**. Class review requests carry
the revision shown to the reviewer; a concurrent change makes an older review
request fail instead of approving unseen changes.

Routine announcements, student allocation, attendance and marks remain class
management actions. They do not require content approval. Internal specialist
notes are not a publication decision. Account deletion and removal of owned
resources retain their existing privacy and removal behavior.

## Existing records

The idempotent migration preserves content, review history and submissions. It
does not fabricate Admin approvals. Existing class activities and resources enter
the review queue because the old schema did not record an Admin publication
decision. Teacher-approved shared content without an Admin decision is held for
review. Existing shipped baseline topics and fixed lessons remain identified as
baselines, not individually reviewed content. Legacy video checks without a
matching recorded Admin decision do not change learner playback until an Admin
records a new decision.

This means previously visible teacher content may disappear from learner views
until reviewed; its stored data and results are retained for staff. This release
is independent of automatic ElevenLabs narration. Before merging narration work,
its activity resolver must also enforce the new content approval state.
