import assert from "node:assert/strict";
import test from "node:test";

const { authorLabel, writtenLabel, versionDecisionMessage } = await import("../app/teach/topics/shared.ts");
const { lessonApprovedMessage } = await import("../app/studio/labels.ts");
const { sheetOrigin } = await import("../app/admin/FamilyImport.tsx");

test("a topic version that came with Bangla Adventures says so; only a deleted author reads as a former staff member", () => {
  const shipped = { authorName: null, baseline: false, shipped: true };
  assert.equal(authorLabel(shipped, "en"), "came with Bangla Adventures");
  assert.equal(authorLabel(shipped, "bn"), "Bangla Adventures-এর সঙ্গে এসেছে");
  assert.equal(writtenLabel(shipped, "en"), "came with Bangla Adventures", "never \"written by came with …\"");
  assert.equal(authorLabel({ ...shipped, version: 0 }, "en"), "came with Bangla Adventures");

  const deleted = { authorName: null, baseline: false, shipped: false };
  assert.equal(authorLabel(deleted, "en"), "a former staff member");
  assert.equal(authorLabel(deleted, "bn"), "একজন সাবেক কর্মী");
  assert.equal(writtenLabel(deleted, "en"), "written by a former staff member");

  const carried = { authorName: null, baseline: true, shipped: false };
  assert.equal(authorLabel(carried, "en"), "an administrator, before topic approval existed");

  const written = { authorName: "Teacher Tania", baseline: false, shipped: false };
  assert.equal(writtenLabel(written, "en"), "written by Teacher Tania");
  assert.equal(writtenLabel(written, "bn"), "লিখেছেন Teacher Tania");
});

test("sending a topic back says what students see: nothing yet, nothing while withdrawn, or the approved version", () => {
  const never = versionDecisionMessage("reject", 1, { approvedVersion: null, withdrawn: false });
  assert.match(never.en, /^Sent back to the author with your note\. Students cannot see this topic until a version of it is approved\.$/);
  assert.doesNotMatch(never.en, /keep seeing/);
  assert.match(never.bn, /কোনো সংস্করণ অনুমোদিত না হওয়া পর্যন্ত/);

  const withdrawn = versionDecisionMessage("reject", 3, { approvedVersion: 2, withdrawn: true });
  assert.match(withdrawn.en, /stays withdrawn, so students still cannot see it/);
  assert.match(withdrawn.bn, /সরিয়ে নেওয়াই থাকছে/);

  const kept = versionDecisionMessage("reject", 3, { approvedVersion: 2, withdrawn: false });
  assert.equal(kept.en, "Sent back to the author with your note. Students keep seeing the approved version.");
  assert.equal(kept.bn, "আপনার নোটসহ লেখকের কাছে ফেরত পাঠানো হয়েছে। শিক্ষার্থীরা অনুমোদিত সংস্করণই দেখবে।");

  const approved = versionDecisionMessage("approve", 2, { approvedVersion: null, withdrawn: false });
  assert.equal(approved.en, "Approved. Students now see version 2 of this topic.");
  assert.equal(approved.bn, "অনুমোদিত। শিক্ষার্থীরা এখন এই বিষয়ের সংস্করণ ২ দেখবে।");
});

test("approving a lesson says \"again\" only when it was approved before", () => {
  const first = lessonApprovedMessage({ visible: false, approvedBefore: false, pendingRevision: 1 });
  assert.equal(first.en, "Approved. Students can now open this lesson.");
  assert.equal(first.bn, "অনুমোদিত। শিক্ষার্থীরা এখন এই পাঠ খুলতে পারবে।");
  assert.doesNotMatch(first.en, /again/);

  const restored = lessonApprovedMessage({ visible: false, approvedBefore: true, pendingRevision: null });
  assert.equal(restored.en, "Approved. Students can open this lesson again.");
  assert.equal(restored.bn, "অনুমোদিত। শিক্ষার্থীরা আবার এই পাঠ খুলতে পারবে।");

  const revision = lessonApprovedMessage({ visible: true, approvedBefore: true, pendingRevision: 2 });
  assert.equal(revision.en, "Approved. Students now see revision 2 of this lesson.");
  assert.equal(revision.bn, "অনুমোদিত। শিক্ষার্থীরা এখন এই পাঠের সংস্করণ ২ দেখবে।");

  const review = lessonApprovedMessage({ visible: true, approvedBefore: true, pendingRevision: null });
  assert.equal(review.en, "Review recorded. Students keep seeing this lesson, now approved under your name.");
});

test("the family sign-in sheet names the configured public address, falling back to the browser's", () => {
  assert.equal(sheetOrigin("https://learn.example.org", "http://10.0.0.5:3000"), "https://learn.example.org");
  assert.equal(sheetOrigin(null, "http://10.0.0.5:3000"), "http://10.0.0.5:3000");
  assert.equal(sheetOrigin(undefined, "https://staging.example.org"), "https://staging.example.org");
  for (const unusable of ["", "learn.example.org", "https://learn.example.org/path", "javascript:alert(1)", 42]) {
    assert.equal(sheetOrigin(unusable, "https://browser.example"), "https://browser.example", String(unusable));
  }
});
