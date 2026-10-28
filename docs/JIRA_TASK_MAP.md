# Individual Jira tasks and GitHub parts

Snapshot checked on 28 October 2026. This register covers every SCRUM item individually and preserves the original Jira assignee, status and parent relationship.

**91 GitHub records:** 83 closed to mirror Jira Done and eight open to mirror the unassigned To Do epics. **All 83 assigned records have GitHub assignees; both Alqahtani Jira accounts belong to `MAQ022`, as confirmed by the repository owner.** All 91 Jira items received a link to their corresponding GitHub issue. The earlier broad role-review issues #2–#8 are closed as superseded.

Source links are pinned to commit [`b59c62f`](https://github.com/omargad/Bangla-Adventure/commit/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b) so they identify the inspected snapshot. See [CONTRIBUTIONS.md](../CONTRIBUTIONS.md) for each person's complete task list and [original contribution evidence](ORIGINAL_CONTRIBUTIONS.md) for verified authored commits from earlier repositories.

## Reading the evidence

- **implemented-area:** corresponding implementation or automated test code exists; this is not independent release acceptance.
- **documentation-area:** a relevant repository document or project artifact exists, subject to the note for that item.
- **related-area-only:** adjacent code/docs exist, but do not establish the full Jira task or original deliverable.
- **not-located:** the requested implementation was not found in this snapshot; linked paths are the relevant adjacent areas.

Jira Done is a recorded workflow state. It does not override a missing implementation, incomplete review, historical deployment target or publication restriction. Similar stories remain separate if Jira gives them distinct keys or owners. Each item's **Import commit** line names the commit that added the files attributed to it, authored by the item's Jira assignee; an item without one delivered no file of the final package (see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md)).

## Task index

| Jira item | Task | Recorded owner | GitHub record |
| --- | --- | --- | --- |
| [SCRUM-2](#scrum-2) | Project Planning & Requirements | Unassigned in Jira | [#9](https://github.com/omargad/Bangla-Adventure/issues/9) |
| [SCRUM-3](#scrum-3) | Educational Content Research | Unassigned in Jira | [#10](https://github.com/omargad/Bangla-Adventure/issues/10) |
| [SCRUM-4](#scrum-4) | UI/UX Design | Unassigned in Jira | [#11](https://github.com/omargad/Bangla-Adventure/issues/11) |
| [SCRUM-5](#scrum-5) | Technology & Architecture | Unassigned in Jira | [#12](https://github.com/omargad/Bangla-Adventure/issues/12) |
| [SCRUM-6](#scrum-6) | Student Platform | Unassigned in Jira | [#13](https://github.com/omargad/Bangla-Adventure/issues/13) |
| [SCRUM-7](#scrum-7) | Teacher Platform | Unassigned in Jira | [#14](https://github.com/omargad/Bangla-Adventure/issues/14) |
| [SCRUM-8](#scrum-8) | Testing & Quality Assurance | Unassigned in Jira | [#15](https://github.com/omargad/Bangla-Adventure/issues/15) |
| [SCRUM-9](#scrum-9) | Deployment & Documentation | Unassigned in Jira | [#16](https://github.com/omargad/Bangla-Adventure/issues/16) |
| [SCRUM-10](#scrum-10) | Finalise Project Scope | BAHAA GHAZI | [#17](https://github.com/omargad/Bangla-Adventure/issues/17) |
| [SCRUM-11](#scrum-11) | Define Project Objectives | BAHAA GHAZI | [#18](https://github.com/omargad/Bangla-Adventure/issues/18) |
| [SCRUM-12](#scrum-12) | Identify Target Users | BAHAA GHAZI | [#19](https://github.com/omargad/Bangla-Adventure/issues/19) |
| [SCRUM-13](#scrum-13) | Define Functional Requirements | BAHAA GHAZI | [#20](https://github.com/omargad/Bangla-Adventure/issues/20) |
| [SCRUM-14](#scrum-14) | Define Non-Functional Requirements | BAHAA GHAZI | [#21](https://github.com/omargad/Bangla-Adventure/issues/21) |
| [SCRUM-15](#scrum-15) | Research NCTB and Official Educational Resources | Mohammed Alajmi | [#22](https://github.com/omargad/Bangla-Adventure/issues/22) |
| [SCRUM-16](#scrum-16) | Identify and Prioritise MVP Topics | Mohammed Alajmi | [#23](https://github.com/omargad/Bangla-Adventure/issues/23) |
| [SCRUM-17](#scrum-17) | Investigate Copyright and Content Usage | Mohammed Alajmi | [#24](https://github.com/omargad/Bangla-Adventure/issues/24) |
| [SCRUM-18](#scrum-18) | Research Child-Friendly Educational Platforms | Dilsha Nishadya | [#25](https://github.com/omargad/Bangla-Adventure/issues/25) |
| [SCRUM-19](#scrum-19) | Research Child-Friendly Content Presentation | Dilsha Nishadya | [#26](https://github.com/omargad/Bangla-Adventure/issues/26) |
| [SCRUM-20](#scrum-20) | Create Initial User Flows | Turki Alahzmi | [#27](https://github.com/omargad/Bangla-Adventure/issues/27) |
| [SCRUM-21](#scrum-21) | Create Initial Wireframes | Turki Alahzmi | [#28](https://github.com/omargad/Bangla-Adventure/issues/28) |
| [SCRUM-22](#scrum-22) | Research and Compare Technology Stack | Mohammed Alqahtani | [#29](https://github.com/omargad/Bangla-Adventure/issues/29) |
| [SCRUM-23](#scrum-23) | Design Initial System Architecture | Mohammed Alqahtani | [#30](https://github.com/omargad/Bangla-Adventure/issues/30) |
| [SCRUM-24](#scrum-24) | Create Initial User Stories | BAHAA GHAZI | [#31](https://github.com/omargad/Bangla-Adventure/issues/31) |
| [SCRUM-25](#scrum-25) | Set Up GitHub Repository | Omar Gad | [#32](https://github.com/omargad/Bangla-Adventure/issues/32) |
| [SCRUM-26](#scrum-26) | As a student, I want to browse Bangladeshi history and culture topics so that I can learn about my heritage. | Mohammed Ali A Alqahtani | [#33](https://github.com/omargad/Bangla-Adventure/issues/33) |
| [SCRUM-27](#scrum-27) | As a student, I want to read child-friendly educational content so that I can understand Bangladeshi history and culture. | Mohammed Ali A Alqahtani | [#34](https://github.com/omargad/Bangla-Adventure/issues/34) |
| [SCRUM-28](#scrum-28) | As a student, I want to complete quizzes so that I can test my understanding. | Mohammed Ali A Alqahtani | [#35](https://github.com/omargad/Bangla-Adventure/issues/35) |
| [SCRUM-29](#scrum-29) | As a student, I want to submit completed activities so that my teacher can review them. | Mohammed Ali A Alqahtani | [#36](https://github.com/omargad/Bangla-Adventure/issues/36) |
| [SCRUM-30](#scrum-30) | As a teacher, I want to create quizzes so that I can assess students. | Mohammed Alajmi | [#37](https://github.com/omargad/Bangla-Adventure/issues/37) |
| [SCRUM-31](#scrum-31) | As a teacher, I want to create activities so that I can provide students with different learning experiences. | Mohammed Alajmi | [#38](https://github.com/omargad/Bangla-Adventure/issues/38) |
| [SCRUM-32](#scrum-32) | As a teacher, I want to view student submissions so that I can review their work. | Mohammed Alajmi | [#39](https://github.com/omargad/Bangla-Adventure/issues/39) |
| [SCRUM-33](#scrum-33) | TEACH-1: Design Teacher Dashboard UI & Authentication. | Mohammed Alajmi | [#40](https://github.com/omargad/Bangla-Adventure/issues/40) |
| [SCRUM-34](#scrum-34) | TEACH-2: Implement CSV Parsing for bulk student upload. | Mohammed Alajmi | [#41](https://github.com/omargad/Bangla-Adventure/issues/41) |
| [SCRUM-35](#scrum-35) | TEACH-3: Build random password generator & user provisioning. | Mohammed Alajmi | [#42](https://github.com/omargad/Bangla-Adventure/issues/42) |
| [SCRUM-36](#scrum-36) | TEACH-4: Build Teacher Gradebook and Results UI. | Mohammed Alajmi | [#43](https://github.com/omargad/Bangla-Adventure/issues/43) |
| [SCRUM-37](#scrum-37) | Implement Child-Friendly Animations and Gamified Feedback | Dilsha Nishadya | [#44](https://github.com/omargad/Bangla-Adventure/issues/44) |
| [SCRUM-38](#scrum-38) | Implement Student Authentication and Login | BAHAA GHAZI | [#45](https://github.com/omargad/Bangla-Adventure/issues/45) |
| [SCRUM-39](#scrum-39) | Implement Student Dashboard | BAHAA GHAZI | [#46](https://github.com/omargad/Bangla-Adventure/issues/46) |
| [SCRUM-40](#scrum-40) | Implement Learning Content Pages | Mohammed Ali A Alqahtani | [#47](https://github.com/omargad/Bangla-Adventure/issues/47) |
| [SCRUM-41](#scrum-41) | Implement Quizzes and Activities | Mohammed Ali A Alqahtani | [#48](https://github.com/omargad/Bangla-Adventure/issues/48) |
| [SCRUM-42](#scrum-42) | Implement Student Results and Progress | Mohammed Ali A Alqahtani | [#49](https://github.com/omargad/Bangla-Adventure/issues/49) |
| [SCRUM-43](#scrum-43) | Implement Teacher Authentication and Dashboard | Mohammed Alajmi | [#50](https://github.com/omargad/Bangla-Adventure/issues/50) |
| [SCRUM-44](#scrum-44) | Implement Automatic Student Account Creation | Mohammed Alajmi | [#51](https://github.com/omargad/Bangla-Adventure/issues/51) |
| [SCRUM-45](#scrum-45) | Implement Temporary Password Generation | Mohammed Alajmi | [#52](https://github.com/omargad/Bangla-Adventure/issues/52) |
| [SCRUM-46](#scrum-46) | Implement Teacher Grades and Results | Mohammed Alajmi | [#53](https://github.com/omargad/Bangla-Adventure/issues/53) |
| [SCRUM-47](#scrum-47) | Implement Admin Dashboard | Turki Alahzmi | [#54](https://github.com/omargad/Bangla-Adventure/issues/54) |
| [SCRUM-48](#scrum-48) | Implement User Management | Turki Alahzmi | [#55](https://github.com/omargad/Bangla-Adventure/issues/55) |
| [SCRUM-49](#scrum-49) | Implement Content Management | Turki Alahzmi | [#56](https://github.com/omargad/Bangla-Adventure/issues/56) |
| [SCRUM-50](#scrum-50) | Implement Educational Content Updating | Turki Alahzmi | [#57](https://github.com/omargad/Bangla-Adventure/issues/57) |
| [SCRUM-51](#scrum-51) | Implement Admin Grades and Results Management | BAHAA GHAZI | [#58](https://github.com/omargad/Bangla-Adventure/issues/58) |
| [SCRUM-52](#scrum-52) | Finalise Technical Architecture and Database | Omar Gad | [#59](https://github.com/omargad/Bangla-Adventure/issues/59) |
| [SCRUM-53](#scrum-53) | Implement Authentication and Role-Based Access Control | Omar Gad | [#60](https://github.com/omargad/Bangla-Adventure/issues/60) |
| [SCRUM-54](#scrum-54) | Configure Vercel Deployment | Omar Gad | [#61](https://github.com/omargad/Bangla-Adventure/issues/61) |
| [SCRUM-55](#scrum-55) | As a student, I want a child-friendly landing page so that I can engage with the platform easily. | Dilsha Nishadya | [#62](https://github.com/omargad/Bangla-Adventure/issues/62) |
| [SCRUM-56](#scrum-56) | Create Student/Teacher/Admin Wireframes | Dilsha Nishadya | [#63](https://github.com/omargad/Bangla-Adventure/issues/63) |
| [SCRUM-57](#scrum-57) | As a student, I want a responsive and visually clear platform so that I can use it comfortably on different devices. | Dilsha Nishadya | [#64](https://github.com/omargad/Bangla-Adventure/issues/64) |
| [SCRUM-58](#scrum-58) | Refine Project Requirements and User Stories | BAHAA GHAZI | [#65](https://github.com/omargad/Bangla-Adventure/issues/65) |
| [SCRUM-59](#scrum-59) | Coordinate Client Feedback and Requirements Changes | BAHAA GHAZI | [#66](https://github.com/omargad/Bangla-Adventure/issues/66) |
| [SCRUM-60](#scrum-60) | Sprint Progress Tracking and Documentation | BAHAA GHAZI | [#67](https://github.com/omargad/Bangla-Adventure/issues/67) |
| [SCRUM-61](#scrum-61) | Conduct System Testing | BAHAA GHAZI | [#68](https://github.com/omargad/Bangla-Adventure/issues/68) |
| [SCRUM-62](#scrum-62) | Conduct Peer Review and Integration Testing | BAHAA GHAZI | [#69](https://github.com/omargad/Bangla-Adventure/issues/69) |
| [SCRUM-63](#scrum-63) | Client Review and Feedback Implementation | BAHAA GHAZI | [#70](https://github.com/omargad/Bangla-Adventure/issues/70) |
| [SCRUM-64](#scrum-64) | Implement Basic Frontend Form Validation | BAHAA GHAZI | [#71](https://github.com/omargad/Bangla-Adventure/issues/71) |
| [SCRUM-65](#scrum-65) | As a student, I want to log in to my account so that I can securely access my learning activities. | Mohammed Ali A Alqahtani | [#72](https://github.com/omargad/Bangla-Adventure/issues/72) |
| [SCRUM-66](#scrum-66) | As a teacher, I want to log in to the teacher dashboard so that I can manage my students and learning activities. | Mohammed Alajmi | [#73](https://github.com/omargad/Bangla-Adventure/issues/73) |
| [SCRUM-67](#scrum-67) | As an admin, I want to log in to the admin dashboard so that I can manage the platform. | Turki Alahzmi | [#74](https://github.com/omargad/Bangla-Adventure/issues/74) |
| [SCRUM-68](#scrum-68) | As a teacher, I want to upload student information using a CSV file so that I can create multiple student accounts efficiently. | Mohammed Alajmi | [#75](https://github.com/omargad/Bangla-Adventure/issues/75) |
| [SCRUM-69](#scrum-69) | As a teacher, I want student accounts to be created automatically after a CSV upload so that I do not have to create each account manually. | Mohammed Alajmi | [#76](https://github.com/omargad/Bangla-Adventure/issues/76) |
| [SCRUM-70](#scrum-70) | As a teacher, I want each student to receive a randomly generated temporary password so that students can securely access their accounts. | Mohammed Alajmi | [#77](https://github.com/omargad/Bangla-Adventure/issues/77) |
| [SCRUM-71](#scrum-71) | As a student, I want to change my temporary password so that I can secure my account. | Mohammed Ali A Alqahtani | [#78](https://github.com/omargad/Bangla-Adventure/issues/78) |
| [SCRUM-72](#scrum-72) | As an admin, I want to manage user accounts so that I can maintain the platform. | Turki Alahzmi | [#79](https://github.com/omargad/Bangla-Adventure/issues/79) |
| [SCRUM-73](#scrum-73) | As an admin, I want to add, edit and update educational content so that learning materials can be kept up to date. | Turki Alahzmi | [#80](https://github.com/omargad/Bangla-Adventure/issues/80) |
| [SCRUM-74](#scrum-74) | As an admin, I want to manage student grades and results so that performance information remains accurate. | BAHAA GHAZI | [#81](https://github.com/omargad/Bangla-Adventure/issues/81) |
| [SCRUM-75](#scrum-75) | Implement CSV Student Upload | Mohammed Alajmi | [#82](https://github.com/omargad/Bangla-Adventure/issues/82) |
| [SCRUM-76](#scrum-76) | As a student, I want to view my results and progress so that I can track my learning performance. | Mohammed Ali A Alqahtani | [#83](https://github.com/omargad/Bangla-Adventure/issues/83) |
| [SCRUM-77](#scrum-77) | As a student, I want to sign in securely so that I can access my learning account. | Mohammed Ali A Alqahtani | [#84](https://github.com/omargad/Bangla-Adventure/issues/84) |
| [SCRUM-78](#scrum-78) | As a student, I want to access learning content and interactive activities so that I can learn about Bangladesh in an engaging way. | Mohammed Ali A Alqahtani | [#85](https://github.com/omargad/Bangla-Adventure/issues/85) |
| [SCRUM-79](#scrum-79) | As a student, I want to view my results and progress so that I can track my learning performance. | BAHAA GHAZI | [#86](https://github.com/omargad/Bangla-Adventure/issues/86) |
| [SCRUM-80](#scrum-80) | As a teacher, I want to manage student accounts using CSV upload so that I can create multiple student accounts efficiently. | Mohammed Alajmi | [#87](https://github.com/omargad/Bangla-Adventure/issues/87) |
| [SCRUM-81](#scrum-81) | As a teacher, I want to view and manage student grades and results so that I can monitor student performance. | Mohammed Alajmi | [#88](https://github.com/omargad/Bangla-Adventure/issues/88) |
| [SCRUM-82](#scrum-82) | As an admin, I want to manage users and educational content so that the platform can be maintained without developer intervention for routine updates. | Turki Alahzmi | [#89](https://github.com/omargad/Bangla-Adventure/issues/89) |
| [SCRUM-83](#scrum-83) | Connect student login to authentication flow | Mohammed Ali A Alqahtani | [#90](https://github.com/omargad/Bangla-Adventure/issues/90) |
| [SCRUM-84](#scrum-84) | As a student, I want a learning-focused dashboard with topic progress so that I can quickly see what to learn next. | Mohammed Ali A Alqahtani | [#91](https://github.com/omargad/Bangla-Adventure/issues/91) |
| [SCRUM-85](#scrum-85) | Create a shared portal layout and consistent navigation pattern | Dilsha Nishadya | [#92](https://github.com/omargad/Bangla-Adventure/issues/92) |
| [SCRUM-86](#scrum-86) | As a teacher, I want to manage classes and allocate students so that young learners do not need to enter class codes. | Mohammed Alajmi | [#93](https://github.com/omargad/Bangla-Adventure/issues/93) |
| [SCRUM-87](#scrum-87) | Organise teacher portal functions into clear pages and sidebar sections | Turki Alahzmi | [#94](https://github.com/omargad/Bangla-Adventure/issues/94) |
| [SCRUM-88](#scrum-88) | Add visible sources and references to educational content | Mohammed Ali A Alqahtani | [#95](https://github.com/omargad/Bangla-Adventure/issues/95) |
| [SCRUM-89](#scrum-89) | Run end-to-end workflow and form-validation regression tests | Omar Gad | [#96](https://github.com/omargad/Bangla-Adventure/issues/96) |
| [SCRUM-90](#scrum-90) | Review teacher recovery-code flow and demonstrate its intended use cases | Omar Gad | [#97](https://github.com/omargad/Bangla-Adventure/issues/97) |
| [SCRUM-91](#scrum-91) | Review UI alignment, child-friendly presentation and responsive consistency | Mohammed Alqahtani | [#98](https://github.com/omargad/Bangla-Adventure/issues/98) |
| [SCRUM-92](#scrum-92) | Clarify admin workflow and confirm curriculum updates end to end | BAHAA GHAZI | [#99](https://github.com/omargad/Bangla-Adventure/issues/99) |

## Tasks requiring evidence or implementation clarification

The following mappings have explicit limits. Their original Jira status and owner are retained; these notes are not new completion claims.

| Jira item | Mapping | Note |
| --- | --- | --- |
| [SCRUM-18](#scrum-18) | related-area-only | The project pack discusses child-oriented design principles and learning resources, and these components implement related presentation. A dedicated comparison/research report of child-friendly platforms was not located. |
| [SCRUM-19](#scrum-19) | related-area-only | Historical design principles and the bilingual topic reader are related to short, engaging child-facing presentation. These artifacts do not establish the original research process or age-suitability approval. |
| [SCRUM-20](#scrum-20) | related-area-only | The Jira description contains the original student/teacher flow. These are its current journey documentation and implementation counterparts; a separate original user-flow design artifact was not located in the repository. |
| [SCRUM-21](#scrum-21) | related-area-only | These current screens correspond to the requested home/topic/learning/quiz/dashboard/submission wireframe areas. No original wireframe images or design source files were located; implemented screens are not evidence of the original wireframe deliverable. |
| [SCRUM-22](#scrum-22) | related-area-only | These files show the selected Next.js/React/Drizzle/SQLite stack and hosting approach. A historical comparison matrix or technology-evaluation report was not located. |
| [SCRUM-23](#scrum-23) | related-area-only | The project pack contains a historical no-account prototype architecture; current README, schema, auth modules and deployment runbook describe its successor. No separate initial architecture diagram for the present account/database system was located. |
| [SCRUM-24](#scrum-24) | related-area-only | The original student/teacher user stories and acceptance criteria are stored in Jira. These are related requirement and current workflow counterparts; no standalone initial backlog/story artifact was located in the imported source. |
| [SCRUM-34](#scrum-34) | not-located | No bulk student CSV parser/import implementation was located in the current custom app. The class-students route allocates an existing username; csvCell in lib/classroom.ts supports grade export, not CSV import. These are the adjacent teacher/roster areas only. |
| [SCRUM-35](#scrum-35) | not-located | No random temporary-password generator or teacher bulk provisioning flow was located. Administrator account creation accepts a supplied password; password.ts hashes passwords and generates recovery/session material, which is not temporary-password provisioning. These are related account-management areas. |
| [SCRUM-44](#scrum-44) | not-located | Automatic student creation after a teacher CSV upload was not located. Existing administrator account creation and staff allocation of already registered students are related components, not proof that automatic bulk account creation exists. |
| [SCRUM-45](#scrum-45) | not-located | A temporary-password generation/provisioning flow was not located. Existing password helpers implement hashing, verification, sessions and recovery codes, while admin creation expects a supplied password. Recovery codes must not be described as temporary passwords. |
| [SCRUM-51](#scrum-51) | related-area-only | An administrator can enter the shared teacher workspace in isAdmin mode, and its results screen is the closest current implementation. Grade and submission routes still filter classes by teacherId equal to the current actor, so these paths do not establish cross-teacher admin grade management. Preserve Bahaa's task boundary separately from Turki's admin shell. |
| [SCRUM-54](#scrum-54) | related-area-only | The Jira title is the historical Vercel deployment task. No Vercel deployment configuration was located; the current documented target is Linux/systemd behind Caddy with persistent SQLite/media, plus a Compose alternative. These are the corresponding current deployment areas, not evidence of a Vercel deployment. |
| [SCRUM-56](#scrum-56) | related-area-only | No standalone student/teacher/admin wireframe artifact was located in the repository. These are the resulting portal interface areas only; their presence must not be presented as the original wireframes or evidence of their author. |
| [SCRUM-59](#scrum-59) | related-area-only | These documents record or prepare client requirements, meetings, draft communication and acceptance evidence. They are related coordination artifacts; they do not prove that a draft message was sent, a meeting occurred, or a client approved a change. |
| [SCRUM-60](#scrum-60) | related-area-only | Jira board structure, sprint scope and reporting remain in the external SCRUM project, with Bahaa identified as the sole Jira manager. These repository files provide related ownership/handover/evidence records, not an archived sprint-board history or proof Bahaa authored the imported documentation. |
| [SCRUM-63](#scrum-63) | related-area-only | Related client-requirements and acceptance/handover records. No dated client-review/sign-off artifact attributable to this Jira task was located in the snapshot; this association does not establish client approval. |
| [SCRUM-68](#scrum-68) | not-located | Related teacher/student-management surfaces only. The current snapshot allocates an already registered username; no teacher CSV upload form or CSV import parser was located. The visible CSV capability is grades export, not student import. |
| [SCRUM-69](#scrum-69) | not-located | Student self-registration and administrator single-account creation exist, and staff can allocate existing students. No CSV-driven bulk student-account creation pipeline was located; these are related account primitives rather than proof of this task. |
| [SCRUM-70](#scrum-70) | not-located | Student creation accepts a supplied password and hashes it. Random values in lib/password.ts are session/recovery material; no generated temporary-student-password provisioning flow or first-login temporary-password flag was located. |
| [SCRUM-71](#scrum-71) | not-located | No student temporary-password change UI/API was located. The existing account/password route authenticates adults with getSessionAdult and changes adult credentials, so it must not be credited as implementing this student story. |
| [SCRUM-74](#scrum-74) | related-area-only | Related shared results/grade-export and submission-reset code. Both grades and submissions routes restrict classes to teacherId=user.id; no unrestricted administrator grade-editing workflow was located. Bahaa remains this individual Jira story owner even though the code is shared with teacher results. |
| [SCRUM-75](#scrum-75) | not-located | No CSV student-upload implementation was located in this snapshot. Current staff allocation uses an exact already registered username, while registration takes individual credentials; grade CSV export is a different function. |
| [SCRUM-80](#scrum-80) | not-located | No teacher CSV import, bulk provisioning, generated temporary-password or import-error report pipeline was located. Related code supports exact-username class allocation, student self-registration and administrator single-account creation only. |
| [SCRUM-91](#scrum-91) | related-area-only | Current shared UI/styles and responsive regression checks are related implementation areas. No separately attributed before/after review package or independent child-usability approval for this task was located; retain the Jira review assignment without asserting that evidence. |

## SCRUM-2

**Project Planning & Requirements**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-2) · [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **documentation-area**. Epic-level requirements and scope association. README records the current custom-app decision; the client-meeting and project-pack documents are historical planning snapshots and do not prove client acceptance.

Corresponding repository parts:

- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

Individual child records: [SCRUM-10](#scrum-10), [SCRUM-11](#scrum-11), [SCRUM-12](#scrum-12), [SCRUM-13](#scrum-13), [SCRUM-14](#scrum-14), [SCRUM-24](#scrum-24), [SCRUM-58](#scrum-58), [SCRUM-59](#scrum-59).

## SCRUM-3

**Educational Content Research**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-3) · [GitHub #10](https://github.com/omargad/Bangla-Adventure/issues/10) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **documentation-area**. Epic-level association with official-source research, source metadata and bilingual topic drafts. Source discovery is distinct from educator, rights or content-publication approval.

Corresponding repository parts:

- [docs/NCTB_CONTENT_AUDIT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_CONTENT_AUDIT.md)
- [docs/NCTB_READING_NOTES.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_READING_NOTES.md)
- [app/nctb-books.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/nctb-books.ts)
- [app/nctb-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/nctb-content.ts)
- [content-sources/manifest.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/content-sources/manifest.json)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)

Individual child records: [SCRUM-15](#scrum-15), [SCRUM-16](#scrum-16), [SCRUM-17](#scrum-17), [SCRUM-88](#scrum-88).

## SCRUM-4

**UI/UX Design**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-4) · [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **implemented-area**. Epic-level association with current UX implementation and historical design principles. Original design-research and wireframe deliverables are not established by these implemented screens.

Corresponding repository parts:

- [app/welcome/Welcome.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/Welcome.tsx)
- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)
- [app/components/PortalFrame.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalFrame.tsx)
- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)

Individual child records: [SCRUM-18](#scrum-18), [SCRUM-19](#scrum-19), [SCRUM-20](#scrum-20), [SCRUM-21](#scrum-21), [SCRUM-55](#scrum-55), [SCRUM-56](#scrum-56), [SCRUM-57](#scrum-57), [SCRUM-85](#scrum-85), [SCRUM-91](#scrum-91).

## SCRUM-5

**Technology & Architecture**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-5) · [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **implemented-area**. Epic-level association with the selected application stack, data model, authentication and current native/Compose deployment architecture. This does not identify who authored each source line.

Corresponding repository parts:

- [package.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/package.json)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [lib/auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/auth.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)

Individual child records: [SCRUM-22](#scrum-22), [SCRUM-23](#scrum-23), [SCRUM-25](#scrum-25), [SCRUM-52](#scrum-52), [SCRUM-53](#scrum-53), [SCRUM-90](#scrum-90).

## SCRUM-6

**Student Platform**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-6) · [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **implemented-area**. Epic-level association with current authenticated student learning, topic reading, class activities, submissions and results. The older token-based classroom code is not the current student allocation flow.

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [app/api/student/submit/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/submit/route.ts)
- [app/api/student/results/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/results/route.ts)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)

Individual child records: [SCRUM-26](#scrum-26), [SCRUM-27](#scrum-27), [SCRUM-28](#scrum-28), [SCRUM-29](#scrum-29), [SCRUM-38](#scrum-38), [SCRUM-39](#scrum-39), [SCRUM-40](#scrum-40), [SCRUM-41](#scrum-41), [SCRUM-42](#scrum-42), [SCRUM-64](#scrum-64), [SCRUM-65](#scrum-65), [SCRUM-71](#scrum-71), [SCRUM-76](#scrum-76), [SCRUM-77](#scrum-77), [SCRUM-78](#scrum-78), [SCRUM-79](#scrum-79), [SCRUM-84](#scrum-84).

## SCRUM-7

**Teacher Platform**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-7) · [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **implemented-area**. Epic-level association with approved-teacher access, class activity creation, allocated students, submissions and results. Current class activities use validated multiple-choice questions.

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/teach/TeacherAccess.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherAccess.tsx)
- [app/api/classes/[id]/activities/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/activities/route.ts)
- [app/api/classes/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/route.ts)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)

Individual child records: [SCRUM-30](#scrum-30), [SCRUM-31](#scrum-31), [SCRUM-32](#scrum-32), [SCRUM-43](#scrum-43), [SCRUM-44](#scrum-44), [SCRUM-45](#scrum-45), [SCRUM-46](#scrum-46), [SCRUM-66](#scrum-66), [SCRUM-68](#scrum-68), [SCRUM-69](#scrum-69), [SCRUM-70](#scrum-70), [SCRUM-74](#scrum-74), [SCRUM-75](#scrum-75), [SCRUM-80](#scrum-80), [SCRUM-81](#scrum-81), [SCRUM-86](#scrum-86), [SCRUM-87](#scrum-87).

## SCRUM-8

**Testing & Quality Assurance**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-8) · [GitHub #15](https://github.com/omargad/Bangla-Adventure/issues/15) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **implemented-area**. Epic-level association with automated verification and the separate human-acceptance ledger. Test files and recorded software runs do not establish independent accessibility, safeguarding or client approval.

Corresponding repository parts:

- [tests/e2e/](https://github.com/omargad/Bangla-Adventure/tree/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/)
- [tests/integration/](https://github.com/omargad/Bangla-Adventure/tree/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/)
- [.github/workflows/ci.yml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/workflows/ci.yml)
- [tests/request-security.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/request-security.test.mjs)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

Individual child records: [SCRUM-61](#scrum-61), [SCRUM-62](#scrum-62), [SCRUM-63](#scrum-63), [SCRUM-89](#scrum-89).

## SCRUM-9

**Deployment & Documentation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-9) · [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16) · Epic · Jira **To Do** / GitHub **open**

Recorded contributor: **Unassigned in Jira**. GitHub assignee: Unassigned, matching Jira.

Mapping: **documentation-area**. Epic-level association with current custom-app deployment and handover records. Host reference files and setup templates do not establish that a particular release is running on the live server.

Corresponding repository parts:

- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)
- [docs/HANDOVER.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/HANDOVER.md)
- [docs/BACKUP_RESTORE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/BACKUP_RESTORE.md)
- [infra/current-server/](https://github.com/omargad/Bangla-Adventure/tree/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/infra/current-server/)
- [infra/custom-app/](https://github.com/omargad/Bangla-Adventure/tree/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/infra/custom-app/)
- [compose.yaml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/compose.yaml)

Individual child records: [SCRUM-47](#scrum-47), [SCRUM-48](#scrum-48), [SCRUM-49](#scrum-49), [SCRUM-50](#scrum-50), [SCRUM-51](#scrum-51), [SCRUM-54](#scrum-54), [SCRUM-60](#scrum-60), [SCRUM-67](#scrum-67), [SCRUM-72](#scrum-72), [SCRUM-73](#scrum-73), [SCRUM-82](#scrum-82), [SCRUM-92](#scrum-92).

## SCRUM-10

**Finalise Project Scope**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-10) · [GitHub #17](https://github.com/omargad/Bangla-Adventure/issues/17) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. Scope and exclusions are documented in the current README and historical client/planning records. Historical prototype and Moodle-first decisions must be read in light of the later custom-app decision.

Import commit: [`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 1 file: `docs/PROJECT_PACK.md`. Disclosure: 1 of this file was already in the August prototype unchanged.

Corresponding repository parts:

- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)

## SCRUM-11

**Define Project Objectives**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-11) · [GitHub #18](https://github.com/omargad/Bangla-Adventure/issues/18) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. The README and client meeting record state the culture/history/literature mission; the project pack includes the earlier product hypothesis and success signals. These record objectives, not evidence of client sign-off.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-13](#scrum-13) ([`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), same contributor), [SCRUM-10](#scrum-10) ([`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), same contributor), [SCRUM-25](#scrum-25) ([`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), Omar Gad).

Corresponding repository parts:

- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)

## SCRUM-12

**Identify Target Users**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-12) · [GitHub #19](https://github.com/omargad/Bangla-Adventure/issues/19) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. The project pack supplies historical child/parent/teacher personas; current README, role policy and acceptance journeys define student, teacher, admin and parent responsibilities.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-10](#scrum-10) ([`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), same contributor), [SCRUM-25](#scrum-25) ([`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), Omar Gad), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)

## SCRUM-13

**Define Functional Requirements**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-13) · [GitHub #20](https://github.com/omargad/Bangla-Adventure/issues/20) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. The client record has requirement traceability, the historical project pack has functional requirements, and README/acceptance journeys describe current product behavior. Historical document status is not independent release verification.

Import commit: [`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 1 file: `docs/CLIENT_REQUIREMENTS_2026-08-10.md`. Disclosure: 1 of this file was already in the August prototype unchanged.

Corresponding repository parts:

- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-14

**Define Non-Functional Requirements**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-14) · [GitHub #21](https://github.com/omargad/Bangla-Adventure/issues/21) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. Historical non-functional requirements cover accessibility, performance, reliability and compatibility; current acceptance/deployment docs and security/responsive code provide related implementation areas. Audits and human approval remain separate.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-10](#scrum-10) ([`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), same contributor), [SCRUM-54](#scrum-54) ([`d187809`](https://github.com/omargad/Bangla-Adventure/commit/d187809ad866c85d00e0cc2bacf77deac427f7f8), Omar Gad), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), Dilsha Nishadya).

Corresponding repository parts:

- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)
- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)
- [lib/request-security.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/request-security.ts)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)

## SCRUM-15

**Research NCTB and Official Educational Resources**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-15) · [GitHub #22](https://github.com/omargad/Bangla-Adventure/issues/22) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-3](#scrum-3) / [GitHub #10](https://github.com/omargad/Bangla-Adventure/issues/10).

Mapping: **documentation-area**. Direct association with the NCTB audit methodology, reading notes, official book metadata and ingestion evidence. Verified source records do not mean the learner adaptations are approved.

Import commit: [`b4a48ae`](https://github.com/omargad/Bangla-Adventure/commit/b4a48ae104c4f087f7543aa8e0b51123d4a8d6a6), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 119 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 117 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [docs/NCTB_CONTENT_AUDIT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_CONTENT_AUDIT.md)
- [docs/NCTB_READING_NOTES.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_READING_NOTES.md)
- [app/nctb-books.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/nctb-books.ts)
- [app/nctb-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/nctb-content.ts)
- [content-sources/manifest.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/content-sources/manifest.json)
- [scripts/crawl-nctb.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/scripts/crawl-nctb.mjs)

## SCRUM-16

**Identify and Prioritise MVP Topics**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-16) · [GitHub #23](https://github.com/omargad/Bangla-Adventure/issues/23) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-3](#scrum-3) / [GitHub #10](https://github.com/omargad/Bangla-Adventure/issues/10).

Mapping: **documentation-area**. Topic inventory and reading notes identify candidate culture/history/literature areas; the optional Moodle manifest records a narrower historical three-topic pilot. Current README distinguishes that pilot from the custom application.

Import commit: [`005b102`](https://github.com/omargad/Bangla-Adventure/commit/005b102c44abe1c9132a811c8f84bd3eb07ae7b9), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 1 file: `moodle/local/banglapilot/data/content-manifest.json`. Disclosure: 1 of this file was already in the August prototype unchanged.

Corresponding repository parts:

- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [docs/NCTB_READING_NOTES.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_READING_NOTES.md)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [moodle/local/banglapilot/data/content-manifest.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/moodle/local/banglapilot/data/content-manifest.json)

## SCRUM-17

**Investigate Copyright and Content Usage**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-17) · [GitHub #24](https://github.com/omargad/Bangla-Adventure/issues/24) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-3](#scrum-3) / [GitHub #10](https://github.com/omargad/Bangla-Adventure/issues/10).

Mapping: **documentation-area**. Rights/provenance constraints and review requirements are recorded here. This maps the copyright-investigation task to its documentation; it does not assert permission for every source, image, poem or recording.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-15](#scrum-15) ([`b4a48ae`](https://github.com/omargad/Bangla-Adventure/commit/b4a48ae104c4f087f7543aa8e0b51123d4a8d6a6), same contributor), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani), [SCRUM-13](#scrum-13) ([`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), BAHAA GHAZI).

Corresponding repository parts:

- [docs/MEDIA_REVIEW.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/MEDIA_REVIEW.md)
- [docs/NCTB_CONTENT_AUDIT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/NCTB_CONTENT_AUDIT.md)
- [content-sources/README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/content-sources/README.md)
- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-18

**Research Child-Friendly Educational Platforms**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-18) · [GitHub #25](https://github.com/omargad/Bangla-Adventure/issues/25) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. The project pack discusses child-oriented design principles and learning resources, and these components implement related presentation. A dedicated comparison/research report of child-friendly platforms was not located.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-55](#scrum-55) ([`4120060`](https://github.com/omargad/Bangla-Adventure/commit/412006070ed8690e4bd2bc64b38483f2c6e5f3e6), same contributor), [SCRUM-57](#scrum-57) ([`9d39bd7`](https://github.com/omargad/Bangla-Adventure/commit/9d39bd7eae7640b4369d14fe27fe3a91acabd9c8), same contributor), [SCRUM-10](#scrum-10) ([`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), BAHAA GHAZI), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani).

Corresponding repository parts:

- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [app/welcome/Welcome.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/Welcome.tsx)
- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)
- [app/components/LessonExperience.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LessonExperience.tsx)

Individual child records: [SCRUM-37](#scrum-37).

## SCRUM-19

**Research Child-Friendly Content Presentation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-19) · [GitHub #26](https://github.com/omargad/Bangla-Adventure/issues/26) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. Historical design principles and the bilingual topic reader are related to short, engaging child-facing presentation. These artifacts do not establish the original research process or age-suitability approval.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-55](#scrum-55) ([`4120060`](https://github.com/omargad/Bangla-Adventure/commit/412006070ed8690e4bd2bc64b38483f2c6e5f3e6), same contributor), [SCRUM-10](#scrum-10) ([`4bc07c5`](https://github.com/omargad/Bangla-Adventure/commit/4bc07c568e9ac1debcc1b460ef4679c5c26240f6), BAHAA GHAZI), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani).

Corresponding repository parts:

- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/welcome/Welcome.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/Welcome.tsx)

## SCRUM-20

**Create Initial User Flows**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-20) · [GitHub #27](https://github.com/omargad/Bangla-Adventure/issues/27) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. The Jira description contains the original student/teacher flow. These are its current journey documentation and implementation counterparts; a separate original user-flow design artifact was not located in the repository.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani), [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)
- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-21

**Create Initial Wireframes**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-21) · [GitHub #28](https://github.com/omargad/Bangla-Adventure/issues/28) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. These current screens correspond to the requested home/topic/learning/quiz/dashboard/submission wireframe areas. No original wireframe images or design source files were located; implemented screens are not evidence of the original wireframe deliverable.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-55](#scrum-55) ([`4120060`](https://github.com/omargad/Bangla-Adventure/commit/412006070ed8690e4bd2bc64b38483f2c6e5f3e6), Dilsha Nishadya), [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani), [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), Dilsha Nishadya).

Corresponding repository parts:

- [app/welcome/Welcome.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/Welcome.tsx)
- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)

## SCRUM-22

**Research and Compare Technology Stack**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-22) · [GitHub #29](https://github.com/omargad/Bangla-Adventure/issues/29) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **related-area-only**. These files show the selected Next.js/React/Drizzle/SQLite stack and hosting approach. A historical comparison matrix or technology-evaluation report was not located.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-25](#scrum-25) ([`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), Omar Gad), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad), [SCRUM-54](#scrum-54) ([`d187809`](https://github.com/omargad/Bangla-Adventure/commit/d187809ad866c85d00e0cc2bacf77deac427f7f8), Omar Gad).

Corresponding repository parts:

- [package.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/package.json)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [next.config.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/next.config.ts)
- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)

## SCRUM-23

**Design Initial System Architecture**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-23) · [GitHub #30](https://github.com/omargad/Bangla-Adventure/issues/30) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **related-area-only**. The project pack contains a historical no-account prototype architecture; current README, schema, auth modules and deployment runbook describe its successor. No separate initial architecture diagram for the present account/database system was located.

Import commit: [`3b6bbdd`](https://github.com/omargad/Bangla-Adventure/commit/3b6bbdd13abc208d138dd878a9e98f92bb649829), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 1 file: `docs/MOODLE_FIRST_MVP.md`. Disclosure: 1 of this file was already in the August prototype unchanged.

Corresponding repository parts:

- [docs/PROJECT_PACK.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/PROJECT_PACK.md)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [lib/auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/auth.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)

## SCRUM-24

**Create Initial User Stories**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-24) · [GitHub #31](https://github.com/omargad/Bangla-Adventure/issues/31) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **related-area-only**. The original student/teacher user stories and acceptance criteria are stored in Jira. These are related requirement and current workflow counterparts; no standalone initial backlog/story artifact was located in the imported source.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-13](#scrum-13) ([`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), same contributor), [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi).

Corresponding repository parts:

- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)
- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)

## SCRUM-25

**Set Up GitHub Repository**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-25) · [GitHub #32](https://github.com/omargad/Bangla-Adventure/issues/32) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **implemented-area**. These repository setup, exclusion, CI and collaboration files support the GitHub setup responsibility. The current files include later maintenance; collaborator invitations and branch administration are GitHub state, not proof supplied by these files alone.

Import commit: [`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 15 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 7 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [.gitignore](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.gitignore)
- [.github/workflows/ci.yml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/workflows/ci.yml)
- [CONTRIBUTIONS.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/CONTRIBUTIONS.md)
- [.github/CODEOWNERS](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/CODEOWNERS)

## SCRUM-26

**As a student, I want to browse Bangladeshi history and culture topics so that I can learn about my heritage.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-26) · [GitHub #33](https://github.com/omargad/Bangla-Adventure/issues/33) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. My Learning and the topic hub browse culture/history/literature themes using the authenticated curriculum catalogue. Topic contents remain draft adaptations with educator-review notices.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), same contributor), [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), Turki Alahzmi).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)

## SCRUM-27

**As a student, I want to read child-friendly educational content so that I can understand Bangladeshi history and culture.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-27) · [GitHub #34](https://github.com/omargad/Bangla-Adventure/issues/34) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. The topic reader renders bilingual sections, facts and sources from the shared catalogue in the learning layout. Child-friendly presentation exists; educational accuracy and age suitability remain separately reviewed.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), same contributor), [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), Turki Alahzmi), [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), Dilsha Nishadya).

Corresponding repository parts:

- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/components/LearningLayout.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LearningLayout.tsx)

## SCRUM-28

**As a student, I want to complete quizzes so that I can test my understanding.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-28) · [GitHub #35](https://github.com/omargad/Bangla-Adventure/issues/35) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student class quizzes submit validated choices to server-side grading; topic self-check quizzes also run in the topic reader and store their self-check scores locally. These two result paths should not be conflated.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-41](#scrum-41) ([`9be0aa7`](https://github.com/omargad/Bangla-Adventure/commit/9be0aa7799088d82000de03f50755770bf3026f6), same contributor), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), same contributor), [SCRUM-30](#scrum-30) ([`fed115d`](https://github.com/omargad/Bangla-Adventure/commit/fed115d76fd3e207a3dc577e206b477be00c6d15), Mohammed Alajmi), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/submit/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/submit/route.ts)
- [lib/classroom.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/classroom.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)

## SCRUM-29

**As a student, I want to submit completed activities so that my teacher can review them.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-29) · [GitHub #36](https://github.com/omargad/Bangla-Adventure/issues/36) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Allocated students submit multiple-choice class activities to activitySubmissions; the teacher class API and dashboard show saved scores/answers. This does not claim generic free-text or file-upload submission support.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-41](#scrum-41) ([`9be0aa7`](https://github.com/omargad/Bangla-Adventure/commit/9be0aa7799088d82000de03f50755770bf3026f6), same contributor), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad), [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/submit/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/submit/route.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [app/api/classes/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/route.ts)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-30

**As a teacher, I want to create quizzes so that I can assess students.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-30) · [GitHub #37](https://github.com/omargad/Bangla-Adventure/issues/37) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. The teacher form creates quizzes with questions/options/answer keys through the owned-class activity API, which validates and persists the question set. Access requires an approved teacher.

Import commit: [`fed115d`](https://github.com/omargad/Bangla-Adventure/commit/fed115d76fd3e207a3dc577e206b477be00c6d15), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 2 files: `lib/classroom.ts`, `tests/classroom.test.mjs`.

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/activities/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/activities/route.ts)
- [lib/classroom.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/classroom.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-31

**As a teacher, I want to create activities so that I can provide students with different learning experiences.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-31) · [GitHub #38](https://github.com/omargad/Bangla-Adventure/issues/38) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. Teachers create titled activities with instructions, an optional learning topic and validated multiple-choice questions. This maps the existing activity model; arbitrary free-text/file-based activity types are not established by this code.

Import commit: [`42f7a1d`](https://github.com/omargad/Bangla-Adventure/commit/42f7a1dbba89917fe054096f78663723204c0562), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 1 file: `app/api/classes/[id]/activities/route.ts`.

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/activities/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/activities/route.ts)
- [lib/classroom.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/classroom.ts)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)

## SCRUM-32

**As a teacher, I want to view student submissions so that I can review their work.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-32) · [GitHub #39](https://github.com/omargad/Bangla-Adventure/issues/39) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. The owned-class GET endpoint loads submissions with parsed answers and student names; the teacher dashboard displays submission/result tables and grade summaries. This does not imply an independent human assessment was performed.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-46](#scrum-46) ([`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), same contributor), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/route.ts)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-33

**TEACH-1: Design Teacher Dashboard UI & Authentication.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-33) · [GitHub #40](https://github.com/omargad/Bangla-Adventure/issues/40) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Mapping: **implemented-area**. The teacher page checks authenticated access and canTeach, renders the request/approval screen for unapproved accounts, and renders TeacherDashboard for approved staff. The adult sign-in form and auth service are shared infrastructure.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/teach/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/page.tsx)
- [app/teach/TeacherAccess.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherAccess.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/api/auth/teacher-request/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/auth/teacher-request/route.ts)
- [lib/auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/auth.ts)

## SCRUM-34

**TEACH-2: Implement CSV Parsing for bulk student upload.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-34) · [GitHub #41](https://github.com/omargad/Bangla-Adventure/issues/41) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Mapping: **not-located**. No bulk student CSV parser/import implementation was located in the current custom app. The class-students route allocates an existing username; csvCell in lib/classroom.ts supports grade export, not CSV import. These are the adjacent teacher/roster areas only.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor), [SCRUM-30](#scrum-30) ([`fed115d`](https://github.com/omargad/Bangla-Adventure/commit/fed115d76fd3e207a3dc577e206b477be00c6d15), same contributor).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)
- [lib/classroom.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/classroom.ts)

## SCRUM-35

**TEACH-3: Build random password generator & user provisioning.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-35) · [GitHub #42](https://github.com/omargad/Bangla-Adventure/issues/42) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Mapping: **not-located**. No random temporary-password generator or teacher bulk provisioning flow was located. Administrator account creation accepts a supplied password; password.ts hashes passwords and generates recovery/session material, which is not temporary-password provisioning. These are related account-management areas.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [lib/password.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/password.ts)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)

## SCRUM-36

**TEACH-4: Build Teacher Gradebook and Results UI.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-36) · [GitHub #43](https://github.com/omargad/Bangla-Adventure/issues/43) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Mapping: **implemented-area**. TeacherDashboard builds grade summaries and results panels, links CSV grade export, and exposes submission reset. The grades and submissions routes restrict these operations to the owning teacher's class.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-46](#scrum-46) ([`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), same contributor).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/api/classes/[id]/submissions/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/submissions/route.ts)

## SCRUM-37

**Implement Child-Friendly Animations and Gamified Feedback**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-37) · [GitHub #44](https://github.com/omargad/Bangla-Adventure/issues/44) · Subtask · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-18](#scrum-18) / [GitHub #25](https://github.com/omargad/Bangla-Adventure/issues/25).

Mapping: **implemented-area**. The adventure interface contains Bagh character text, stars, earned badges and activity feedback; LessonExperience supplies mastery feedback. Global styles contain the animation and reduced-motion rules. This maps the present feedback surfaces, not independent confirmation of every animation listed in Jira.

Import commit: [`dd7fee9`](https://github.com/omargad/Bangla-Adventure/commit/dd7fee9d94c4afb4fcc47042adc267b28ae475c7), authored by Dilsha Nishadya ([@104985376](https://github.com/104985376)), adds 12 files: `app/adventure/page.tsx`, `public/audio/hello-bn.ogg`, `public/audio/word-boat-bn.ogg`, `public/audio/word-boat-example-bn.ogg`, `public/audio/word-friend-bn.ogg`, `public/audio/word-friend-example-bn.ogg`, `public/audio/word-river-bn.ogg`, `public/audio/word-river-example-bn.ogg`, `public/audio/word-tiger-bn.ogg`, `public/audio/word-tiger-example-bn.ogg`, `public/postcard-collage.png`, `public/river-story.png`. Disclosure: 11 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [app/adventure/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/adventure/page.tsx)
- [app/components/LessonExperience.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LessonExperience.tsx)
- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)

## SCRUM-38

**Implement Student Authentication and Login**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-38) · [GitHub #45](https://github.com/omargad/Bangla-Adventure/issues/45) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. The student page loads the database-backed session, StudentPortal submits the sign-in form, and the student auth routes/service verify credentials and create sessions. Preserve Bahaa as this individual Jira task's assignee even though later student-login tasks belong to Mohammed Ali A Alqahtani.

Import commit: [`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 6 files: `app/api/student/session/route.ts`, `app/api/student/sign-in/route.ts`, `app/api/student/sign-out/route.ts`, `app/api/student/sign-up/route.ts`, `app/student/page.tsx`, `lib/student-auth.ts`.

Corresponding repository parts:

- [app/student/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/page.tsx)
- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/sign-in/route.ts)
- [app/api/student/session/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/session/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [lib/password.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/password.ts)

## SCRUM-39

**Implement Student Dashboard**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-39) · [GitHub #46](https://github.com/omargad/Bangla-Adventure/issues/46) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. StudentPortal renders My Learning, classes, activities and progress metrics using the student feed and curriculum catalogue in the shared portal shell. This records Bahaa's dashboard task separately from the later learning-dashboard refinement.

Import commit: [`d6c8a1f`](https://github.com/omargad/Bangla-Adventure/commit/d6c8a1f5a51cd43afdbcb8c55b723aa24ab92f0e), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 1 file: `app/api/student/feed/route.ts`.

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)

## SCRUM-40

**Implement Learning Content Pages**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-40) · [GitHub #47](https://github.com/omargad/Bangla-Adventure/issues/47) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. TopicsHub displays bilingual reading topics fetched from the curriculum catalogue; topic definitions and LessonExperience provide related lesson content. Draft/educator-review notices remain part of the content and this mapping does not approve educational accuracy.

Import commit: [`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 227 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 222 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [app/topics/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/page.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [app/components/LessonExperience.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LessonExperience.tsx)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)

## SCRUM-41

**Implement Quizzes and Activities**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-41) · [GitHub #48](https://github.com/omargad/Bangla-Adventure/issues/48) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. StudentPortal loads allocated class activities, collects answers and submits them to the student submission API. TopicsHub and LessonExperience contain additional learning checks; classroom helpers validate and grade quiz answers.

Import commit: [`9be0aa7`](https://github.com/omargad/Bangla-Adventure/commit/9be0aa7799088d82000de03f50755770bf3026f6), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 18 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 17 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/student/submit/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/submit/route.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [lib/classroom.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/classroom.ts)
- [app/components/LessonExperience.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LessonExperience.tsx)

## SCRUM-42

**Implement Student Results and Progress**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-42) · [GitHub #49](https://github.com/omargad/Bangla-Adventure/issues/49) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. The student interface shows results and topic/activity progress. Student feed/results routes scope records to the signed-in student, and topic-progress persists reading progress using the schema's student progress records.

Import commit: [`3bb0d3a`](https://github.com/omargad/Bangla-Adventure/commit/3bb0d3a30ed508d7e4c97fcaf45232397263c839), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 1 file: `app/api/student/results/route.ts`.

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/student/results/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/results/route.ts)
- [app/api/student/topic-progress/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/topic-progress/route.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)

## SCRUM-43

**Implement Teacher Authentication and Dashboard**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-43) · [GitHub #50](https://github.com/omargad/Bangla-Adventure/issues/50) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. The teacher portal uses adult authentication, explicit request/approval and role checks before rendering class-management and results screens. This is the individual implementation issue alongside the earlier TEACH-1 design/authentication task.

Import commit: [`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 6 files: `app/api/auth/teacher-request/route.ts`, `app/api/classes/[id]/announcements/route.ts`, `app/api/classes/[id]/route.ts`, `app/teach/TeacherAccess.tsx`, `app/teach/TeacherDashboard.tsx`, `app/teach/page.tsx`.

Corresponding repository parts:

- [app/teach/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/page.tsx)
- [app/teach/TeacherAccess.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherAccess.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/api/auth/teacher-request/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/auth/teacher-request/route.ts)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)

## SCRUM-44

**Implement Automatic Student Account Creation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-44) · [GitHub #51](https://github.com/omargad/Bangla-Adventure/issues/51) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. Automatic student creation after a teacher CSV upload was not located. Existing administrator account creation and staff allocation of already registered students are related components, not proof that automatic bulk account creation exists.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi).

Corresponding repository parts:

- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)
- [lib/enrollments.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/enrollments.ts)

## SCRUM-45

**Implement Temporary Password Generation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-45) · [GitHub #52](https://github.com/omargad/Bangla-Adventure/issues/52) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. A temporary-password generation/provisioning flow was not located. Existing password helpers implement hashing, verification, sessions and recovery codes, while admin creation expects a supplied password. Recovery codes must not be described as temporary passwords.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi).

Corresponding repository parts:

- [lib/password.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/password.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)

## SCRUM-46

**Implement Teacher Grades and Results**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-46) · [GitHub #53](https://github.com/omargad/Bangla-Adventure/issues/53) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. The results section summarizes submissions and exports grades; class routes support retrieving grades and resetting submissions for the owning teacher. Integration tests cover the classroom submission/result flow.

Import commit: [`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 3 files: `app/api/classes/[id]/grades/route.ts`, `app/api/classes/[id]/submissions/route.ts`, `tests/integration/classroom-flow.test.mjs`.

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/api/classes/[id]/submissions/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/submissions/route.ts)
- [tests/integration/classroom-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/classroom-flow.test.mjs)

## SCRUM-47

**Implement Admin Dashboard**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-47) · [GitHub #54](https://github.com/omargad/Bangla-Adventure/issues/54) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. Admin page access is guarded and the admin shell connects user management, class allocation and curriculum editing. Jira explicitly gives Turki the shell/navigation and users/content, while Bahaa's separate task owns admin grades/results.

Import commit: [`8cc88be`](https://github.com/omargad/Bangla-Adventure/commit/8cc88be61c933dcccf17df53b946d4936902c897), authored by Turki Alahzmi ([@Tlm0v](https://github.com/Tlm0v)), adds 1 file: `app/admin/page.tsx`.

Corresponding repository parts:

- [app/admin/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/page.tsx)
- [app/admin/UserManagement.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/UserManagement.tsx)
- [app/admin/classes/AdminClasses.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/classes/AdminClasses.tsx)
- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)

## SCRUM-48

**Implement User Management**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-48) · [GitHub #55](https://github.com/omargad/Bangla-Adventure/issues/55) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. UserManagement and its admin APIs implement listing/creating/updating accounts, teacher approval, suspension and session invalidation through transactionally audited user-management functions.

Import commit: [`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), authored by Turki Alahzmi ([@Tlm0v](https://github.com/Tlm0v)), adds 5 files: `app/admin/UserManagement.tsx`, `app/api/admin/users/[id]/route.ts`, `app/api/admin/users/route.ts`, `lib/user-management.ts`, `tests/user-management.test.mjs`.

Corresponding repository parts:

- [app/admin/UserManagement.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/UserManagement.tsx)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)
- [app/api/admin/users/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/%5Bid%5D/route.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [tests/user-management.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/user-management.test.mjs)

## SCRUM-49

**Implement Content Management**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-49) · [GitHub #56](https://github.com/omargad/Bangla-Adventure/issues/56) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. The admin editor manages existing topic reading and the content studio handles draft/review workflows. Current curriculum PUT updates selected existing topics and retains sources/quizzes/review gates; this is not evidence of unrestricted creation/deletion or publication approval.

Import commit: [`7ffbad2`](https://github.com/omargad/Bangla-Adventure/commit/7ffbad20cd76754edfb9fd9c91ca3cdb35c583cb), authored by Turki Alahzmi ([@Tlm0v](https://github.com/Tlm0v)), adds 8 files: `app/api/audio/[lessonId]/[slot]/route.ts`, `app/api/studio/drafts/route.ts`, `app/api/studio/media/route.ts`, `app/api/studio/reviews/route.ts`, `app/api/studio/video-reviews/route.ts`, `app/studio/ContentStudio.tsx`, `app/studio/page.tsx`, `lib/storage.ts`. Disclosure: 3 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/api/admin/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/studio/ContentStudio.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/studio/ContentStudio.tsx)
- [app/api/studio/drafts/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/studio/drafts/route.ts)

## SCRUM-50

**Implement Educational Content Updating**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-50) · [GitHub #57](https://github.com/omargad/Bangla-Adventure/issues/57) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. The editor saves bilingual title/introduction/reading updates with optimistic version checks. The shared catalogue surfaces updates to learners while preserving sources, quizzes and educator-review status; workflow tests cover propagation and permissions.

Import commit: [`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), authored by Turki Alahzmi ([@Tlm0v](https://github.com/Tlm0v)), adds 4 files: `app/admin/curriculum/CurriculumEditor.tsx`, `app/admin/curriculum/page.tsx`, `app/api/admin/curriculum/route.ts`, `lib/curriculum-catalog.ts`.

Corresponding repository parts:

- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/api/admin/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [tests/portal-workflows.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/portal-workflows.test.mjs)

## SCRUM-51

**Implement Admin Grades and Results Management**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-51) · [GitHub #58](https://github.com/omargad/Bangla-Adventure/issues/58) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **related-area-only**. An administrator can enter the shared teacher workspace in isAdmin mode, and its results screen is the closest current implementation. Grade and submission routes still filter classes by teacherId equal to the current actor, so these paths do not establish cross-teacher admin grade management. Preserve Bahaa's task boundary separately from Turki's admin shell.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-46](#scrum-46) ([`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), Mohammed Alajmi).

Corresponding repository parts:

- [app/teach/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/page.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/api/classes/[id]/submissions/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/submissions/route.ts)

## SCRUM-52

**Finalise Technical Architecture and Database**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-52) · [GitHub #59](https://github.com/omargad/Bangla-Adventure/issues/59) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **implemented-area**. The schema, SQLite connection/bootstrap and additive access migration define the current database implementation; Drizzle configuration and the current deployment runbook describe runtime/storage integration. This maps the final architecture/database task to the current source.

Import commit: [`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 14 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 8 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)
- [db/index.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/index.ts)
- [db/bootstrap.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/bootstrap.ts)
- [db/access-migration.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/access-migration.ts)
- [drizzle.config.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/drizzle.config.ts)
- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)

## SCRUM-53

**Implement Authentication and Role-Based Access Control**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-53) · [GitHub #60](https://github.com/omargad/Bangla-Adventure/issues/60) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **implemented-area**. Adult/student session services, role predicates, shared session precedence and proxy access handling implement authentication and role controls. The RBAC integration suite exercises role boundaries; runtime authorization also remains in route handlers.

Import commit: [`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 36 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 7 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [lib/auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/auth.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)
- [lib/session-status.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/session-status.ts)
- [proxy.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/proxy.ts)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)

## SCRUM-54

**Configure Vercel Deployment**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-54) · [GitHub #61](https://github.com/omargad/Bangla-Adventure/issues/61) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **related-area-only**. The Jira title is the historical Vercel deployment task. No Vercel deployment configuration was located; the current documented target is Linux/systemd behind Caddy with persistent SQLite/media, plus a Compose alternative. These are the corresponding current deployment areas, not evidence of a Vercel deployment.

Import commit: [`d187809`](https://github.com/omargad/Bangla-Adventure/commit/d187809ad866c85d00e0cc2bacf77deac427f7f8), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 29 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list. Disclosure: 16 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [docs/DEPLOYMENT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/DEPLOYMENT.md)
- [infra/current-server/bangla-adventures.service](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/infra/current-server/bangla-adventures.service)
- [infra/current-server/Caddyfile.bangla.example](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/infra/current-server/Caddyfile.bangla.example)
- [infra/custom-app/bangla-adventures.service](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/infra/custom-app/bangla-adventures.service)
- [compose.yaml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/compose.yaml)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)

## SCRUM-55

**As a student, I want a child-friendly landing page so that I can engage with the platform easily.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-55) · [GitHub #62](https://github.com/omargad/Bangla-Adventure/issues/62) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **implemented-area**. The public welcome page and its component provide the child-facing landing experience; global styles supply presentation and the root page routes anonymous visitors to /welcome. Signed-in users follow their current account portal.

Import commit: [`4120060`](https://github.com/omargad/Bangla-Adventure/commit/412006070ed8690e4bd2bc64b38483f2c6e5f3e6), authored by Dilsha Nishadya ([@104985376](https://github.com/104985376)), adds 3 files: `app/welcome/Welcome.tsx`, `app/welcome/page.tsx`, `public/hero-quest-map.png`. Disclosure: 1 of these file was already in the August prototype unchanged.

Corresponding repository parts:

- [app/welcome/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/page.tsx)
- [app/welcome/Welcome.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/welcome/Welcome.tsx)
- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)
- [app/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/page.tsx)

## SCRUM-56

**Create Student/Teacher/Admin Wireframes**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-56) · [GitHub #63](https://github.com/omargad/Bangla-Adventure/issues/63) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. No standalone student/teacher/admin wireframe artifact was located in the repository. These are the resulting portal interface areas only; their presence must not be presented as the original wireframes or evidence of their author.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), same contributor), [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi).

Corresponding repository parts:

- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)
- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/admin/UserManagement.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/UserManagement.tsx)

## SCRUM-57

**As a student, I want a responsive and visually clear platform so that I can use it comfortably on different devices.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-57) · [GitHub #64](https://github.com/omargad/Bangla-Adventure/issues/64) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **implemented-area**. Shared styles and portal containers implement responsive layout and navigation, with browser workflow coverage at multiple viewport widths. The mapping does not substitute for independent accessibility or child-usability approval.

Import commit: [`9d39bd7`](https://github.com/omargad/Bangla-Adventure/commit/9d39bd7eae7640b4369d14fe27fe3a91acabd9c8), authored by Dilsha Nishadya ([@104985376](https://github.com/104985376)), adds 1 file: `app/globals.css`.

Corresponding repository parts:

- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)
- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)
- [app/components/PortalFrame.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalFrame.tsx)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-58

**Refine Project Requirements and User Stories**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-58) · [GitHub #65](https://github.com/omargad/Bangla-Adventure/issues/65) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **documentation-area**. The dated client-requirements record and current README/acceptance record are related requirements artifacts. The older meeting document includes historical Moodle-first decisions; current README records the custom-app decision. A dedicated Jira user-story refinement history is external, not proved by these files.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-13](#scrum-13) ([`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), same contributor), [SCRUM-25](#scrum-25) ([`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), Omar Gad).

Corresponding repository parts:

- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [README.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/README.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-59

**Coordinate Client Feedback and Requirements Changes**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-59) · [GitHub #66](https://github.com/omargad/Bangla-Adventure/issues/66) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-2](#scrum-2) / [GitHub #9](https://github.com/omargad/Bangla-Adventure/issues/9).

Mapping: **related-area-only**. These documents record or prepare client requirements, meetings, draft communication and acceptance evidence. They are related coordination artifacts; they do not prove that a draft message was sent, a meeting occurred, or a client approved a change.

Import commit: [`c46b97b`](https://github.com/omargad/Bangla-Adventure/commit/c46b97b6d708f8cd5795e2ff5fa10d550ddfc2d0), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 2 files: `docs/CLIENT_EMAIL_DRAFT.md`, `docs/FIRST_MEETING_AGENDA.md`. Disclosure: 2 of these files were already in the August prototype unchanged.

Corresponding repository parts:

- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/FIRST_MEETING_AGENDA.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/FIRST_MEETING_AGENDA.md)
- [docs/CLIENT_EMAIL_DRAFT.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_EMAIL_DRAFT.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-60

**Sprint Progress Tracking and Documentation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-60) · [GitHub #67](https://github.com/omargad/Bangla-Adventure/issues/67) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **related-area-only**. Jira board structure, sprint scope and reporting remain in the external SCRUM project, with Bahaa identified as the sole Jira manager. These repository files provide related ownership/handover/evidence records, not an archived sprint-board history or proof Bahaa authored the imported documentation.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-54](#scrum-54) ([`d187809`](https://github.com/omargad/Bangla-Adventure/commit/d187809ad866c85d00e0cc2bacf77deac427f7f8), Omar Gad).

Corresponding repository parts:

- [CONTRIBUTIONS.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/CONTRIBUTIONS.md)
- [docs/atlassian-role-mapping.json](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/atlassian-role-mapping.json)
- [docs/HANDOVER.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/HANDOVER.md)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)

## SCRUM-61

**Conduct System Testing**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-61) · [GitHub #68](https://github.com/omargad/Bangla-Adventure/issues/68) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-8](#scrum-8) / [GitHub #15](https://github.com/omargad/Bangla-Adventure/issues/15).

Mapping: **implemented-area**. System and role workflow tests, CI configuration and the verification record are the corresponding testing areas. Recorded automated results are separate from this Jira assignee's personal test execution or human release sign-off.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-62](#scrum-62) ([`9b71f1f`](https://github.com/omargad/Bangla-Adventure/commit/9b71f1f4c91c9339a93568d7079198e3dc3508de), same contributor), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-25](#scrum-25) ([`44b646b`](https://github.com/omargad/Bangla-Adventure/commit/44b646b73d3850224ef7d213fbb8ea3a696c5151), Omar Gad).

Corresponding repository parts:

- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)
- [tests/e2e/access.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/access.spec.ts)
- [tests/integration/api-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/api-flow.test.mjs)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)
- [.github/workflows/ci.yml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/workflows/ci.yml)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)

## SCRUM-62

**Conduct Peer Review and Integration Testing**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-62) · [GitHub #69](https://github.com/omargad/Bangla-Adventure/issues/69) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-8](#scrum-8) / [GitHub #15](https://github.com/omargad/Bangla-Adventure/issues/15).

Mapping: **implemented-area**. Integration suites and CI cover API, classroom and RBAC interactions; the verification record supplies automated-run evidence. A specific human peer-review record was not located, so these files do not independently prove the peer-review part of the Jira task.

Import commit: [`9b71f1f`](https://github.com/omargad/Bangla-Adventure/commit/9b71f1f4c91c9339a93568d7079198e3dc3508de), authored by BAHAA GHAZI ([@bahaa11-prog](https://github.com/bahaa11-prog)), adds 1 file: `tests/integration/api-flow.test.mjs`.

Corresponding repository parts:

- [tests/integration/api-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/api-flow.test.mjs)
- [tests/integration/classroom-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/classroom-flow.test.mjs)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)
- [.github/workflows/ci.yml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/workflows/ci.yml)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)

## SCRUM-63

**Client Review and Feedback Implementation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-63) · [GitHub #70](https://github.com/omargad/Bangla-Adventure/issues/70) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-8](#scrum-8) / [GitHub #15](https://github.com/omargad/Bangla-Adventure/issues/15).

Mapping: **related-area-only**. Related client-requirements and acceptance/handover records. No dated client-review/sign-off artifact attributable to this Jira task was located in the snapshot; this association does not establish client approval.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-13](#scrum-13) ([`6cc2804`](https://github.com/omargad/Bangla-Adventure/commit/6cc2804ba4f8b15e387841ca1c3166e456b06233), same contributor), [SCRUM-54](#scrum-54) ([`d187809`](https://github.com/omargad/Bangla-Adventure/commit/d187809ad866c85d00e0cc2bacf77deac427f7f8), Omar Gad).

Corresponding repository parts:

- [docs/CLIENT_REQUIREMENTS_2026-08-10.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/CLIENT_REQUIREMENTS_2026-08-10.md)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)
- [docs/HANDOVER.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/HANDOVER.md)

## SCRUM-64

**Implement Basic Frontend Form Validation**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-64) · [GitHub #71](https://github.com/omargad/Bangla-Adventure/issues/71) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student/adult authentication forms, class allocation and curriculum editing contain required-field, length, format and error states. The complete-workflow browser test covers selected invalid and successful flows; this does not prove exhaustive validation of every form.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), Mohammed Alajmi), [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), Turki Alahzmi), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)
- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-65

**As a student, I want to log in to my account so that I can securely access my learning activities.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-65) · [GitHub #72](https://github.com/omargad/Bangla-Adventure/issues/72) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student login UI posts credentials to the sign-in route, which verifies the active student, rate-limits attempts and issues the student session cookie; successful navigation reaches My Learning.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/student/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/page.tsx)
- [app/api/student/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/sign-in/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-66

**As a teacher, I want to log in to the teacher dashboard so that I can manage my students and learning activities.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-66) · [GitHub #73](https://github.com/omargad/Bangla-Adventure/issues/73) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. Teacher entry uses adult sign-in and checks canTeach before rendering the dashboard. Pending/unapproved teachers see TeacherAccess, and browser coverage exercises registration, approval gating and class access.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/teach/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/page.tsx)
- [app/teach/TeacherAccess.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherAccess.tsx)
- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/api/auth/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/auth/sign-in/route.ts)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)
- [tests/e2e/access.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/access.spec.ts)

## SCRUM-67

**As an admin, I want to log in to the admin dashboard so that I can manage the platform.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-67) · [GitHub #74](https://github.com/omargad/Bangla-Adventure/issues/74) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. The admin entry requires an existing admin role; requireAdmin rejects other signed-in accounts and account switching has dedicated browser regression coverage. This flow never grants admin merely through sign-in.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-47](#scrum-47) ([`8cc88be`](https://github.com/omargad/Bangla-Adventure/commit/8cc88be61c933dcccf17df53b946d4936902c897), same contributor), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/admin/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/page.tsx)
- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/grown-ups/GrownUpsContent.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/GrownUpsContent.tsx)
- [app/api/auth/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/auth/sign-in/route.ts)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)
- [tests/e2e/access.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/access.spec.ts)

## SCRUM-68

**As a teacher, I want to upload student information using a CSV file so that I can create multiple student accounts efficiently.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-68) · [GitHub #75](https://github.com/omargad/Bangla-Adventure/issues/75) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. Related teacher/student-management surfaces only. The current snapshot allocates an already registered username; no teacher CSV upload form or CSV import parser was located. The visible CSV capability is grades export, not student import.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)

## SCRUM-69

**As a teacher, I want student accounts to be created automatically after a CSV upload so that I do not have to create each account manually.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-69) · [GitHub #76](https://github.com/omargad/Bangla-Adventure/issues/76) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. Student self-registration and administrator single-account creation exist, and staff can allocate existing students. No CSV-driven bulk student-account creation pipeline was located; these are related account primitives rather than proof of this task.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi).

Corresponding repository parts:

- [app/api/student/sign-up/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/sign-up/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)

## SCRUM-70

**As a teacher, I want each student to receive a randomly generated temporary password so that students can securely access their accounts.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-70) · [GitHub #77](https://github.com/omargad/Bangla-Adventure/issues/77) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. Student creation accepts a supplied password and hashes it. Random values in lib/password.ts are session/recovery material; no generated temporary-student-password provisioning flow or first-login temporary-password flag was located.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad).

Corresponding repository parts:

- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [lib/password.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/password.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)

## SCRUM-71

**As a student, I want to change my temporary password so that I can secure my account.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-71) · [GitHub #78](https://github.com/omargad/Bangla-Adventure/issues/78) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **not-located**. No student temporary-password change UI/API was located. The existing account/password route authenticates adults with getSessionAdult and changes adult credentials, so it must not be credited as implementing this student story.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [app/api/account/password/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/account/password/route.ts)

## SCRUM-72

**As an admin, I want to manage user accounts so that I can maintain the platform.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-72) · [GitHub #79](https://github.com/omargad/Bangla-Adventure/issues/79) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. Administrator UI and APIs list/create/update accounts, approve teachers, suspend accounts and revoke sessions; shared service code records audited changes and tests permissions and session invalidation.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), same contributor), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/admin/UserManagement.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/UserManagement.tsx)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)
- [app/api/admin/users/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/%5Bid%5D/route.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)
- [tests/user-management.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/user-management.test.mjs)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)

## SCRUM-73

**As an admin, I want to add, edit and update educational content so that learning materials can be kept up to date.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-73) · [GitHub #80](https://github.com/omargad/Bangla-Adventure/issues/80) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. Administrator editor updates existing bilingual topic readings with validation, optimistic versions and audit records, then serves them to the learner view. New topic creation is not exposed by this editor; existing sources, quizzes and educator-review gates are retained.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), same contributor), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani).

Corresponding repository parts:

- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/api/admin/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)

## SCRUM-74

**As an admin, I want to manage student grades and results so that performance information remains accurate.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-74) · [GitHub #81](https://github.com/omargad/Bangla-Adventure/issues/81) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **related-area-only**. Related shared results/grade-export and submission-reset code. Both grades and submissions routes restrict classes to teacherId=user.id; no unrestricted administrator grade-editing workflow was located. Bahaa remains this individual Jira story owner even though the code is shared with teacher results.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-46](#scrum-46) ([`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), Mohammed Alajmi), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/api/classes/[id]/submissions/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/submissions/route.ts)
- [lib/roles.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/roles.ts)

## SCRUM-75

**Implement CSV Student Upload**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-75) · [GitHub #82](https://github.com/omargad/Bangla-Adventure/issues/82) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. No CSV student-upload implementation was located in this snapshot. Current staff allocation uses an exact already registered username, while registration takes individual credentials; grade CSV export is a different function.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)

## SCRUM-76

**As a student, I want to view my results and progress so that I can track my learning performance.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-76) · [GitHub #83](https://github.com/omargad/Bangla-Adventure/issues/83) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student UI displays completed activities, scores, average result and stored topic-reading progress. Feed/results routes scope data through active student enrollments and persisted submissions; retain this story separately from the similarly worded SCRUM-79.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-42](#scrum-42) ([`3bb0d3a`](https://github.com/omargad/Bangla-Adventure/commit/3bb0d3a30ed508d7e4c97fcaf45232397263c839), same contributor), [SCRUM-39](#scrum-39) ([`d6c8a1f`](https://github.com/omargad/Bangla-Adventure/commit/d6c8a1f5a51cd43afdbcb8c55b723aa24ab92f0e), BAHAA GHAZI), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/student/results/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/results/route.ts)
- [app/api/student/topic-progress/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/topic-progress/route.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)

## SCRUM-77

**As a student, I want to sign in securely so that I can access my learning account.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-77) · [GitHub #84](https://github.com/omargad/Bangla-Adventure/issues/84) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student credential verification, active-account/session handling and My Learning navigation are implemented by these surfaces. SCRUM-77 is preserved separately from SCRUM-65 and its implementation subtask SCRUM-83.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/student/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/page.tsx)
- [app/api/student/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/sign-in/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

Individual child records: [SCRUM-83](#scrum-83).

## SCRUM-78

**As a student, I want to access learning content and interactive activities so that I can learn about Bangladesh in an engaging way.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-78) · [GitHub #85](https://github.com/omargad/Bangla-Adventure/issues/85) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. Student learning links lead to topic readings and sources; allocated activities are loaded from the scoped feed and submitted through the student endpoint. Learning routes require a session and topic content retains review notices.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), same contributor), [SCRUM-41](#scrum-41) ([`9be0aa7`](https://github.com/omargad/Bangla-Adventure/commit/9be0aa7799088d82000de03f50755770bf3026f6), same contributor), [SCRUM-39](#scrum-39) ([`d6c8a1f`](https://github.com/omargad/Bangla-Adventure/commit/d6c8a1f5a51cd43afdbcb8c55b723aa24ab92f0e), BAHAA GHAZI), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/student/submit/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/submit/route.ts)
- [lib/learning-policy.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/learning-policy.ts)

## SCRUM-79

**As a student, I want to view my results and progress so that I can track my learning performance.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-79) · [GitHub #86](https://github.com/omargad/Bangla-Adventure/issues/86) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. The same results/progress surfaces support this separately assigned Jira story. Preserve Bahaa as the SCRUM-79 owner and Mohammed Ali A Alqahtani as SCRUM-76 owner; matching descriptions do not merge their task records or prove source-line authorship.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-39](#scrum-39) ([`d6c8a1f`](https://github.com/omargad/Bangla-Adventure/commit/d6c8a1f5a51cd43afdbcb8c55b723aa24ab92f0e), same contributor), [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), Mohammed Ali A Alqahtani), [SCRUM-42](#scrum-42) ([`3bb0d3a`](https://github.com/omargad/Bangla-Adventure/commit/3bb0d3a30ed508d7e4c97fcaf45232397263c839), Mohammed Ali A Alqahtani), [SCRUM-52](#scrum-52) ([`6cc32cd`](https://github.com/omargad/Bangla-Adventure/commit/6cc32cdc13357d27ca4c4a22df618ff8940c3d7c), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [app/api/student/results/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/results/route.ts)
- [app/api/student/topic-progress/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/topic-progress/route.ts)
- [db/schema.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/db/schema.ts)

## SCRUM-80

**As a teacher, I want to manage student accounts using CSV upload so that I can create multiple student accounts efficiently.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-80) · [GitHub #87](https://github.com/omargad/Bangla-Adventure/issues/87) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **not-located**. No teacher CSV import, bulk provisioning, generated temporary-password or import-error report pipeline was located. Related code supports exact-username class allocation, student self-registration and administrator single-account creation only.

Import commit: none of its own; each file of the package belongs to exactly one item. The requested implementation was not located in the package (see the mapping note). The adjacent areas listed below were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-86](#scrum-86) ([`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), Turki Alahzmi).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)

## SCRUM-81

**As a teacher, I want to view and manage student grades and results so that I can monitor student performance.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-81) · [GitHub #88](https://github.com/omargad/Bangla-Adventure/issues/88) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. Teacher dashboard summarizes stored submissions, exposes per-class grade CSV export and can reset a submission through the owner-scoped DELETE endpoint. These paths support teacher results management; they do not expose arbitrary manual score editing.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), same contributor), [SCRUM-46](#scrum-46) ([`b0e0fbb`](https://github.com/omargad/Bangla-Adventure/commit/b0e0fbb45edc2545fda16988a925ab660a43c8b2), same contributor).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/api/classes/[id]/grades/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/grades/route.ts)
- [app/api/classes/[id]/submissions/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/submissions/route.ts)
- [app/api/classes/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/route.ts)
- [tests/integration/classroom-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/classroom-flow.test.mjs)

## SCRUM-82

**As an admin, I want to manage users and educational content so that the platform can be maintained without developer intervention for routine updates.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-82) · [GitHub #89](https://github.com/omargad/Bangla-Adventure/issues/89) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. Administrator account management and existing-topic reading updates are represented here. The curriculum editor updates known topics rather than adding new topic definitions; review gates remain separate from successful saves.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-48](#scrum-48) ([`6c06ffc`](https://github.com/omargad/Bangla-Adventure/commit/6c06ffcd69b0922708477e78ca67dbedaa24f30d), same contributor), [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), same contributor).

Corresponding repository parts:

- [app/admin/UserManagement.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/UserManagement.tsx)
- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/api/admin/users/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/route.ts)
- [app/api/admin/users/[id]/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/users/%5Bid%5D/route.ts)
- [app/api/admin/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/curriculum/route.ts)
- [lib/user-management.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/user-management.ts)

## SCRUM-83

**Connect student login to authentication flow**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-83) · [GitHub #90](https://github.com/omargad/Bangla-Adventure/issues/90) · Subtask · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-77](#scrum-77) / [GitHub #84](https://github.com/omargad/Bangla-Adventure/issues/84).

Mapping: **implemented-area**. Student form submission calls the authentication endpoint, creates the student session and uses full navigation to the requested student destination. Session-status logic recognizes the current account; this is the implementation subtask of SCRUM-77.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-84](#scrum-84) ([`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), same contributor), [SCRUM-38](#scrum-38) ([`ef89cb8`](https://github.com/omargad/Bangla-Adventure/commit/ef89cb82b123448ea68b59ebb374fa7afc7f9cf4), BAHAA GHAZI), [SCRUM-53](#scrum-53) ([`ab8d3b2`](https://github.com/omargad/Bangla-Adventure/commit/ab8d3b224bc5a3bf7171d8028fa6c91a26ad39a9), Omar Gad).

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/api/student/sign-in/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/sign-in/route.ts)
- [lib/student-auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/student-auth.ts)
- [app/student/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/page.tsx)
- [lib/session-status.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/session-status.ts)

## SCRUM-84

**As a student, I want a learning-focused dashboard with topic progress so that I can quickly see what to learn next.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-84) · [GitHub #91](https://github.com/omargad/Bangla-Adventure/issues/91) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-6](#scrum-6) / [GitHub #13](https://github.com/omargad/Bangla-Adventure/issues/13).

Mapping: **implemented-area**. My Learning presents topic cards, stored read-topic markers, allocated class activities and submission-derived progress totals. The browser workflow checks student landing, topic navigation and persistence of reading completion; these source paths do not establish representative-child acceptance.

Import commit: [`b1ce40c`](https://github.com/omargad/Bangla-Adventure/commit/b1ce40caebe7c5d0d6a066de46cf9f5717ab4e84), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 2 files: `app/api/student/topic-progress/route.ts`, `app/student/StudentPortal.tsx`.

Corresponding repository parts:

- [app/student/StudentPortal.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/StudentPortal.tsx)
- [app/student/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/student/page.tsx)
- [app/api/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/curriculum/route.ts)
- [app/api/student/topic-progress/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/topic-progress/route.ts)
- [app/api/student/feed/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/student/feed/route.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-85

**Create a shared portal layout and consistent navigation pattern**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-85) · [GitHub #92](https://github.com/omargad/Bangla-Adventure/issues/92) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Dilsha Nishadya**. GitHub assignee: [@104985376](https://github.com/104985376).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **implemented-area**. Shared shell/frame components supply role-appropriate navigation, active states and responsive menus; LearningLayout wraps learning pages. Browser coverage checks common portal navigation and overflow across desktop, tablet and mobile widths.

Import commit: [`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), authored by Dilsha Nishadya ([@104985376](https://github.com/104985376)), adds 16 files; see [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) for the list.

Corresponding repository parts:

- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)
- [app/components/PortalFrame.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalFrame.tsx)
- [app/components/LearningLayout.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/LearningLayout.tsx)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-86

**As a teacher, I want to manage classes and allocate students so that young learners do not need to enter class codes.**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-86) · [GitHub #93](https://github.com/omargad/Bangla-Adventure/issues/93) · Story · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alajmi**. GitHub assignee: [@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. Teacher/class UI allocates existing registered students by exact username, updates/removes active enrollment without deleting learning records, and rejects unauthorized allocation and handles duplicate allocation idempotently without creating a second roster entry. Tests cover permission boundaries and the no-class-code student journey.

Import commit: [`21f86fa`](https://github.com/omargad/Bangla-Adventure/commit/21f86fa270eb82dcd9b1c6ae5a86c1c12e824d8c), authored by Mohammed Alajmi ([@MohammedAlAjmi24](https://github.com/MohammedAlAjmi24)), adds 8 files: `app/admin/classes/AdminClasses.tsx`, `app/admin/classes/page.tsx`, `app/api/classes/[id]/students/route.ts`, `app/api/classes/route.ts`, `app/api/classroom/join/route.ts`, `app/api/student/join/route.ts`, `app/components/ClassAllocation.tsx`, `lib/enrollments.ts`.

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/ClassAllocation.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/ClassAllocation.tsx)
- [app/api/classes/[id]/students/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/classes/%5Bid%5D/students/route.ts)
- [lib/enrollments.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/enrollments.ts)
- [tests/portal-workflows.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/portal-workflows.test.mjs)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-87

**Organise teacher portal functions into clear pages and sidebar sections**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-87) · [GitHub #94](https://github.com/omargad/Bangla-Adventure/issues/94) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Turki Alahzmi**. GitHub assignee: [@Tlm0v](https://github.com/Tlm0v).

Parent: [SCRUM-7](#scrum-7) / [GitHub #14](https://github.com/omargad/Bangla-Adventure/issues/14).

Mapping: **implemented-area**. TeacherDashboard groups classes, students, activities, results and announcements behind sidebar sections, retaining shared navigation and responsive behavior. The functions remain sections within the dashboard rather than all becoming separate route pages.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-43](#scrum-43) ([`62b28af`](https://github.com/omargad/Bangla-Adventure/commit/62b28af755dea02da7ddda43ca4d61171ad1043d), Mohammed Alajmi), [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), Dilsha Nishadya), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/teach/TeacherDashboard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/teach/TeacherDashboard.tsx)
- [app/components/PortalFrame.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalFrame.tsx)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-88

**Add visible sources and references to educational content**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-88) · [GitHub #95](https://github.com/omargad/Bangla-Adventure/issues/95) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Ali A Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-3](#scrum-3) / [GitHub #10](https://github.com/omargad/Bangla-Adventure/issues/10).

Mapping: **implemented-area**. Topic source records render beside reading and link to the references/NCTB collection; the workflow test checks source visibility and retained draft notices. Visible citations are not proof that every adaptation has passed educator, rights or cultural review.

Import commit: [`de337ac`](https://github.com/omargad/Bangla-Adventure/commit/de337accd3d12df254ea943ed64ea545add3890d), authored by Mohammed Ali A Alqahtani ([@MAQ022](https://github.com/MAQ022)), adds 1 file: `app/references/page.tsx`.

Corresponding repository parts:

- [app/references/page.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/references/page.tsx)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [app/topics-content.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics-content.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/nctb-books.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/nctb-books.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)

## SCRUM-89

**Run end-to-end workflow and form-validation regression tests**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-89) · [GitHub #96](https://github.com/omargad/Bangla-Adventure/issues/96) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-8](#scrum-8) / [GitHub #15](https://github.com/omargad/Bangla-Adventure/issues/15).

Mapping: **implemented-area**. The complete browser journey covers teacher registration/approval, class allocation, activity publishing/submission, results, curriculum updates and recovery with selected validation failures. Related API/unit checks and the verification record provide reproducible evidence for the tested release, not live-server approval.

Import commit: [`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 6 files: `playwright.config.ts`, `tests/e2e/access.spec.ts`, `tests/e2e/complete-workflow.spec.ts`, `tests/e2e/grown-up.spec.ts`, `tests/e2e/learner.spec.ts`, `tests/portal-workflows.test.mjs`.

Corresponding repository parts:

- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)
- [tests/e2e/access.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/access.spec.ts)
- [tests/integration/rbac-flow.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/integration/rbac-flow.test.mjs)
- [tests/portal-workflows.test.mjs](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/portal-workflows.test.mjs)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)
- [.github/workflows/ci.yml](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/.github/workflows/ci.yml)

## SCRUM-90

**Review teacher recovery-code flow and demonstrate its intended use cases**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-90) · [GitHub #97](https://github.com/omargad/Bangla-Adventure/issues/97) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Omar Gad**. GitHub assignee: [@omargad](https://github.com/omargad).

Parent: [SCRUM-5](#scrum-5) / [GitHub #12](https://github.com/omargad/Bangla-Adventure/issues/12).

Mapping: **implemented-area**. Sign-up UI explains one-time recovery codes; recovery and regeneration APIs use the authentication service, and the browser workflow demonstrates reset plus refusal to reuse a consumed code. The acceptance record retains the human demonstration/sign-off requirement.

Import commit: [`5048755`](https://github.com/omargad/Bangla-Adventure/commit/5048755ceb6dfe0d52aa6292f3fca36e8949f625), authored by Omar Gad ([@omargad](https://github.com/omargad)), adds 2 files: `app/api/account/recovery-codes/route.ts`, `app/api/auth/recover/route.ts`. Disclosure: 1 of these file was already in the August prototype unchanged.

Corresponding repository parts:

- [app/grown-ups/AuthCard.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/grown-ups/AuthCard.tsx)
- [app/api/auth/recover/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/auth/recover/route.ts)
- [app/api/account/recovery-codes/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/account/recovery-codes/route.ts)
- [lib/auth.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/auth.ts)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-91

**Review UI alignment, child-friendly presentation and responsive consistency**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-91) · [GitHub #98](https://github.com/omargad/Bangla-Adventure/issues/98) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **Mohammed Alqahtani**. GitHub assignee: [@MAQ022](https://github.com/MAQ022).

Parent: [SCRUM-4](#scrum-4) / [GitHub #11](https://github.com/omargad/Bangla-Adventure/issues/11).

Mapping: **related-area-only**. Current shared UI/styles and responsive regression checks are related implementation areas. No separately attributed before/after review package or independent child-usability approval for this task was located; retain the Jira review assignment without asserting that evidence.

Import commit: none of its own; each file of the package belongs to exactly one item. Its related areas were added under [SCRUM-85](#scrum-85) ([`ad45a15`](https://github.com/omargad/Bangla-Adventure/commit/ad45a1569cb6ae2d76d943c8ac8415424d3074e0), Dilsha Nishadya), [SCRUM-57](#scrum-57) ([`9d39bd7`](https://github.com/omargad/Bangla-Adventure/commit/9d39bd7eae7640b4369d14fe27fe3a91acabd9c8), Dilsha Nishadya), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/components/PortalShell.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalShell.tsx)
- [app/components/PortalFrame.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/components/PortalFrame.tsx)
- [app/portal.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/portal.css)
- [app/globals.css](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/globals.css)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)
- [docs/ACCEPTANCE.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/ACCEPTANCE.md)

## SCRUM-92

**Clarify admin workflow and confirm curriculum updates end to end**

[Jira source](https://ictprojectb26.atlassian.net/browse/SCRUM-92) · [GitHub #99](https://github.com/omargad/Bangla-Adventure/issues/99) · Task · Jira **Done** / GitHub **closed**

Recorded contributor: **BAHAA GHAZI**. GitHub assignee: [@bahaa11-prog](https://github.com/bahaa11-prog).

Parent: [SCRUM-9](#scrum-9) / [GitHub #16](https://github.com/omargad/Bangla-Adventure/issues/16).

Mapping: **implemented-area**. Existing-topic admin edits are validated, version-checked and read back in the student topic view. The full browser workflow demonstrates save-to-learner visibility, forbidden student mutation and preserved draft/source notices; new topic creation and client production acceptance are separate claims.

Import commit: none of its own; each file of the package belongs to exactly one item. Its corresponding files were added under [SCRUM-50](#scrum-50) ([`c6fc3fb`](https://github.com/omargad/Bangla-Adventure/commit/c6fc3fbf3915bb7772b7250c610a705cab0159a7), Turki Alahzmi), [SCRUM-40](#scrum-40) ([`f96c03a`](https://github.com/omargad/Bangla-Adventure/commit/f96c03a13d65d76f0c0e92bf2c7fa401b006a5e0), Mohammed Ali A Alqahtani), [SCRUM-89](#scrum-89) ([`494f03f`](https://github.com/omargad/Bangla-Adventure/commit/494f03f63097b463609978581f0b85d8085b5256), Omar Gad).

Corresponding repository parts:

- [app/admin/curriculum/CurriculumEditor.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/admin/curriculum/CurriculumEditor.tsx)
- [app/api/admin/curriculum/route.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/api/admin/curriculum/route.ts)
- [lib/curriculum-catalog.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/lib/curriculum-catalog.ts)
- [app/topics/TopicsHub.tsx](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/app/topics/TopicsHub.tsx)
- [tests/e2e/complete-workflow.spec.ts](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/tests/e2e/complete-workflow.spec.ts)
- [docs/VERIFICATION.md](https://github.com/omargad/Bangla-Adventure/blob/b59c62f8de9c1461cfa1fb4ecaf6c6e5bb0cbd4b/docs/VERIFICATION.md)
