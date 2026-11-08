# Content review pack for the first administrator

A new installation of Bangla Adventures starts with all **15 topics** and all **18 lessons**
waiting for an administrator's approval. Students and parents see none of them until an
administrator approves each one, and no lesson video plays until an administrator makes a
separate decision about it ([Content approval](CONTENT_APPROVAL.md#existing-records)). This
pack helps the school's first administrator organise that review: who checks what, what to
look for, the order to work in and roughly how long it takes.

It comes with a worksheet listing every topic and lesson, with its title, the textbook it
cites, and empty columns for the reviewers to fill in:

- [content-review-worksheet.xlsx](content-review-worksheet.xlsx) for Excel or Numbers;
- [content-review-worksheet.csv](content-review-worksheet.csv), the same list as plain text,
  for Google Sheets or any other spreadsheet.

The worksheet lists the content as it stands in the project repository on 8 November 2026
(`main` at commit `4a61a2c`). Every title, textbook and video in it is taken from the
application's own content files.

## Contents

1. [You can start before the site is live](#you-can-start-before-the-site-is-live)
2. [Who reviews what](#who-reviews-what)
3. [How approval works in the app](#how-approval-works-in-the-app)
4. [What to check](#what-to-check)
5. [Using the worksheet](#using-the-worksheet)
6. [Suggested order and time](#suggested-order-and-time)
7. [After approval](#after-approval)

## You can start before the site is live

Approvals are stored in the school's own production site, so the decisions themselves can
only be made there, once it is installed. The reading, checking and discussion can start
now:

- share the worksheet with the reviewers and agree who takes which rows;
- reviewers with a staff account on any running copy of Bangla Adventures can already read
  every topic and lesson there (a teacher can preview them all, approved or not; see
  [Previewing lessons](user-guides/teacher.md#previewing-lessons) in the Teacher guide);
- record the findings in the worksheet.

Approvals given on another copy (the demonstration site, private staging or a copy on a
computer) do **not** carry over: on the production site every item starts as waiting. On
launch day the administrator then works down the worksheet, re-reads anything a reviewer
flagged, and records each decision in the app. If a topic or lesson has changed since the
reviewer read it, read it again.

## Who reviews what

The project's [honest delivery status](../README.md#honest-delivery-status) records that
qualified educator, source and community review, native-speaker review and media
verification are all still outstanding. The software checks none of these. They need people:

| Reviewer | Looks at | In the app |
| --- | --- | --- |
| **Administrator** | Everything, and makes the decision on each item | Approves topics, lessons, recordings and videos |
| **Diaspora educator** | The English text: reading level, age suitability, instructions, the quizzes and their answers | Can record a **Learning design** check on a lesson |
| **Native Bangla speaker** (ideally a Bangla educator) | The Bangla text: spelling, grammar, natural wording, translation, transliteration, and how the computer voice pronounces it | Can record a **Bangla language** check on a lesson |
| **Cultural and source reviewer** (history, culture, community) | Facts against the cited NCTB textbook, respectful and balanced presentation of people, faiths and communities | Can record a **Cultural representation** check on a lesson |
| **Media reviewer** | Each lesson video: that it exists, is the right one, is suitable for children and has captions | Can record an **External media** check on a lesson |

One person can hold more than one of these roles. An administrator who does not read Bangla
fluently should not approve on their own judgement of the Bangla: wait for the native
speaker's notes. The same roles appear in the
[acceptance record's evidence ledger](ACCEPTANCE.md#evidence-ledger) (Bangla accuracy,
English adaptation and age suitability, historical and cultural accuracy, media and rights).

**Accounts for reviewers.** Reviewers who are not administrators can use a **Teacher**
account. A teacher can preview every topic and lesson, and can record a check under
**Detailed specialist checks (optional)** at the bottom of a lesson (see
[Specialist checks](user-guides/teacher.md#specialist-checks-optional)). A teacher cannot
approve anything. Keep **Teachers' topics need an administrator's approval** switched on
during the review (see [Who needs approval](user-guides/administrator.md#who-needs-approval)),
so that any edit a reviewer makes to a topic waits for you. A specialist check is a note
only: it does not publish anything.

## How approval works in the app

The step-by-step instructions, with pictures, are in the
[Administrator guide](user-guides/administrator.md#approving-content-before-students-see-it).
In short:

| Item | Where | What you do |
| --- | --- | --- |
| **Topics** (15) | **Topics** in the menu, under **Waiting for approval** | **Preview & review**, read the **Student view preview** in **English** and **বাংলা** (or **Side by side**), including the quiz; tick **I have read the whole topic, including its quiz, in English and Bangla**; select **Approve and publish to students**. Or write a **Note for the author (needed to send it back)** and select **Send back to the author** ([Topics](user-guides/administrator.md#topics)) |
| **Lessons** (18) | **Lessons** in the menu | **Preview lesson**; open all seven parts (**Overview**, **Listen**, **Read**, **Speak**, **Write**, **Watch**, **Mastery**) in **English** and **বাংলা** until **Parts of the lesson opened: 7 of 7**; tick **I have reviewed the whole lesson in English and Bangla**; select **Approve revision for students** ([Lessons](user-guides/administrator.md#lessons)) |
| **Video decisions** (one per lesson) | **Lessons**, inside the lesson, **Video check** | **Watch on YouTube**; choose **Decision**, **Captions** and **Suitable for children?**; add a **Replacement YouTube link** and **Notes** if needed; select **Save video check** ([Lesson videos](user-guides/administrator.md#lesson-videos-a-separate-decision)) |
| **Recordings** (none at first) | **Lessons**, **Recordings waiting for review**, then **Review in the lesson** | Play the whole recording; tick **I listened to the whole recording**; select **Approve recording** ([Recordings of real voices](user-guides/administrator.md#recordings-of-real-voices)) |

Points worth knowing before you start:

- **Approving a lesson does not approve its video.** Each lesson's video needs its own
  **Video check**. Learners see the video only once its decision is **Approved** and
  **Suitable for children?** is **Suitable** or **Needs a grown-up watching**. **Replace this
  video**, **Unavailable on YouTube** or **Unsuitable for children** takes it out of the
  lesson; if you give a replacement link, learners see that video instead.
- **The 15 built-in topics say they were written by *a former staff member*.** That is normal.
  It also means a note sent back with **Send back to the author** reaches nobody who is still
  working on them. To correct a built-in topic, it is usually quicker to select **Edit**, make
  the agreed change and save it: as an administrator your edit is published at once
  ([Your own topics](user-guides/administrator.md#your-own-topics)), so make the change only
  after the reviewers agree the wording.
- **Lessons have no "send back" button.** Their text is part of the application's source
  code. If a lesson needs changing, leave it waiting, write the problem in the worksheet and
  pass it to whoever maintains the application. The corrected lesson arrives with a later
  release as a new revision waiting for approval.
- **Recordings** appear only after a teacher uploads one with the speaker's consent. A new
  installation has none, so learners hear a computer voice
  ([Which voice learners hear](MEDIA_REVIEW.md#which-voice-learners-hear)).
- **Nothing is approved by a test or by the software.** A successful build proves only that
  the program works; it does not approve the Bangla, the facts, the videos or age suitability.

## What to check

### Every topic and lesson

**Accuracy against the cited NCTB source.** The worksheet's *Source* column names the NCTB
book, classes and chapter each item cites. For topics it also gives the matching chapter
from the textbook library, marked *read from the 2026 book* or *not yet checked against the
book*. These are pointers, not page references: nobody has yet confirmed the exact edition
and page behind each claim. Open the book from the topic's source links or from
**Sources & references** in the menu (the administrator keeps these links up to date on
**Textbook links**; see
[Keeping the NCTB textbook links up to date](user-guides/administrator.md#keeping-the-nctb-textbook-links-up-to-date)),
find the chapter, and check names, dates, numbers and events. Write the edition and page
you checked in *Notes*. Where a book is marked *edition still to be confirmed*, confirm
with the school which edition its classes use. Several lessons cite no NCTB book; check
them against the other source they name, or against a reliable reference, and say which in
*Notes*.

**Bangla spelling and naturalness.** Read every Bangla line, not just the title: headings,
body text, fun facts, quiz questions and answers, and in lessons the dialogue, word lists,
sentence patterns, instructions and practice models. Check spelling, grammar and that it
sounds like natural, child-friendly Bangla rather than a word-for-word translation. Check
that the English and Bangla say the same thing. In lessons, check the transliterations
(the Bangla written in English letters) too.

**Age suitability.** The learners are children of Bangladeshi heritage growing up outside
Bangladesh. Check the reading level and length, that hard words are explained, and that
difficult history (1952, 1971, disasters) is told calmly and without frightening detail. In
lessons, the worksheet's *Category or band* column gives the lesson's level, from Seedling
(the youngest beginners) to Young Scholar.

**Cultural respect.** Check that faiths, festivals, communities, places and people are
described accurately and respectfully, that no group is presented as the whole country,
and that contested history is framed fairly. Take particular care with *Festivals of many
faiths*, *The hill and plains communities*, the four history topics and the lessons
*Why 21 February matters* and *Identity across two homes*.

**Quizzes and their answers.** Each topic has three questions and each lesson two. Check
that every question can be answered from the text, that exactly one answer is right, and
that it is the one marked as right, in both languages. In a topic preview, answer every
question and select **Check my answers**: the preview then shows the answer marked as
right. The lesson preview shows the correct answers. Students see a topic's answers in a
shuffled order, so a topic question must not depend on the order (for example "all of the
above").

**Links.** Open every link: the textbook links on topics, and the outside sources some
lessons cite (UNESCO pages, listed in the worksheet). Check that each opens, is the page
it claims to be, and is suitable for a child to open.

### Lesson videos

Follow [Media review](MEDIA_REVIEW.md). In short:

- The video links came from the first prototype and **nobody has yet confirmed** that they
  open real, relevant, child-appropriate videos. Treat each as a candidate.
- Whoever runs the server can first check that every video still exists, from a network that
  can reach YouTube, with `npm run verify:media`; it prints the title YouTube returns for
  each one ([Step 1](MEDIA_REVIEW.md#step-1--automated-existence-check)). A video that
  opens is still not approved.
- Watch the **whole** video. Check it is the one in the worksheet (title and channel), that
  it fits the lesson, that it is suitable for children (including what YouTube shows around
  it), and whether it has captions. The worksheet's *Has video* column gives the segment the
  lesson asks learners to watch.
- Record the decision in **Video check**
  ([Step 3](MEDIA_REVIEW.md#step-3--record-the-human-decision)). If a video is wrong or
  gone, choose **Replace this video** and paste a replacement link, or ask whoever maintains
  the application to change it in the lesson.
- Each lesson also lists a playlist and two other videos. Learners never see these; they are
  for staff only and need no decision.

### Sound and recordings

- In the lesson preview, play the sound in **Listen**, **Read** and **Speak**. It is a
  computer voice and may mispronounce words, especially names. The native Bangla speaker
  notes any wrong word in *Notes*. A wrong clip can be fixed by uploading a real person's
  recording of that part, or by whoever runs the server remaking it
  ([Media review, step 7](MEDIA_REVIEW.md#a-better-bangla-computer-voice-elevenlabs)).
- For each uploaded recording: listen to all of it, check it matches the lesson text, is
  clear and natural, credits the right speaker, and that consent was confirmed (for a child,
  a parent or guardian must agree too).

## Using the worksheet

The worksheet has one row for each topic (shaded) and each lesson. The columns are:

| Column | What it holds |
| --- | --- |
| Type, ID | *Topic* or *Lesson*, and the item's short name in the application |
| Title (English), Title (Bangla) | The titles as they appear in the app |
| Category or band | A topic's category; a lesson's level and category |
| Source | The NCTB book, classes and chapter the item cites, as recorded in the application; for lessons, also any other source the lesson cites |
| Has quiz | How many quiz questions it has |
| Has video | For lessons: the video's title, channel, length, YouTube code and the segment learners watch |
| **Reviewer**, **Date reviewed**, **Decision**, **Notes** | For the reviewers to fill in (shaded in the Excel file) |

- **Decision** is *Approve* or *Send back*. For a lesson, *Send back* means "leave it waiting
  and pass the notes on", because lessons have no send-back button.
- Use **Notes** for what needs changing, the textbook edition and page checked, and for
  lessons the video decision you will record (for example "Video: Approved, captions
  partial, needs a grown-up watching").
- When several people review one item, add each person's name and findings in *Reviewer*
  and *Notes*, or keep one copy of the worksheet per reviewer and combine them.
- Keep the completed worksheet with the acceptance records. The app keeps its own record of
  who approved what and when.

If the CSV changes, rebuild the Excel file with
`python3 scripts/build-content-review-workbook.py` (it needs `openpyxl`).

## Suggested order and time

1. **Prepare** (about an hour). Agree the reviewers and give them accounts; check that the
   three switches under **Who needs approval** are on; share the worksheet.
2. **Practise on one short topic** (about 30 minutes). *Symbols of Bangladesh* is short and
   cites one book. It shows you every step before the harder topics.
3. **The other 14 topics**, about 20 to 30 minutes each for the administrator once the
   reviewers' notes are in: about 6 hours. Start with history (*Ekushey*, *1971*,
   *British rule*, *Ancient Bengal*), which makes the most factual claims, then culture,
   our country and literature. If the school already knows which topics its first classes
   will use, approve those first.
4. **The 18 lessons**, in level order from Seedling to Young Scholar, as the youngest
   learners usually start first. A lesson has seven parts in two languages: allow 40 to 60
   minutes each, about 15 hours in all. Make each lesson's **Video check** in the same
   sitting. The videos add about 2 hours of watching (most are 2 to 5 minutes; four run
   10 to 20 minutes, and two have no stated length).
5. **Recordings**, as teachers upload them, about 5 minutes each.

That is about **24 hours of administrator time**, plus the reviewers' own time working
alongside, which depends on how familiar they are with the textbooks. These are estimates.
Short sittings of an hour or two over two to three weeks work better than long ones, and a
topic or lesson can be approved as soon as it is ready: there is no need to finish the
whole list first.

## After approval

- **Students and parents see it at once.** An approved topic appears under the students'
  **Learning topics**, and an approved lesson can be opened. A teacher can check the topics
  with **Topics as students see them** in their menu. A lesson's video appears only after its
  own approved **Video check**.
- **Everything is recorded.** The topic's **Version history** and the lesson's
  **Approval history** show your name and the date, and **Recent changes** lists each
  approval ([Recent changes](user-guides/administrator.md#recent-changes-the-record-of-actions)).
- **Narration.** Approved topics get **Listen in Bangla** buttons. New narration needs the
  school's own ElevenLabs key on the server; it is a computer voice, not a pronunciation
  check ([Optional narration](user-guides/administrator.md#optional-narration-computer-voice)).
- **Changes come back for approval.** If someone edits an approved topic, or a later release
  changes a lesson, the new version waits for you and students keep seeing the approved one
  until you approve it.
- **Mistakes can be withdrawn.** **Withdraw from students** hides a topic or lesson
  straight away (you give a reason) and keeps students' saved progress. Correct it, then
  approve it again.
- **Record the outcome.** Update the matching rows of the
  [acceptance record's evidence ledger](ACCEPTANCE.md#evidence-ledger) with the reviewers'
  names, the date and a reference to the completed worksheet.
- **Classes come next.** Class activities, quizzes and class sources from teachers are
  reviewed in each class as they arrive
  ([Class activities and class sources](user-guides/administrator.md#class-activities-and-class-sources)).
