import { test, expect } from "@playwright/test";
import { browserApi, createFixtureAccount } from "./helpers/content-fixtures";

/**
 * This dependency runs before any published-content scenario. A real fresh DB
 * must be hidden first; only these explicitly reviewed test fixtures are then
 * published, through the same Admin endpoints used by the application.
 */
test("fresh shipped content is hidden until an administrator reviews the text and media fixtures", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const learner = await createFixtureAccount(browser, baseURL, "student");
  const admin = await createFixtureAccount(browser, baseURL, "admin");
  try {
    await learner.page.goto("/topics");
    const unpublished = await browserApi(learner.page, "GET", "/api/curriculum");
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.topics).toEqual([]);
    await expect(learner.page.locator(".topic-card")).toHaveCount(0);
    await learner.page.goto("/adventure?module=hello-me");
    await expect(learner.page.getByText("That lesson is not available at the moment. Choose another lesson below.", { exact: true })).toBeVisible();
    await expect(learner.page.getByRole("dialog", { name: "Full curriculum lesson" })).toHaveCount(0);

    const lessonList = await browserApi(admin.page, "GET", "/api/studio/lessons");
    expect(lessonList.status).toBe(200);
    expect(lessonList.body.lessons).toHaveLength(18);
    expect(lessonList.body.lessons.every((lesson: { status: string }) => lesson.status === "waiting")).toBe(true);
    const topics = await browserApi(admin.page, "GET", "/api/topics");
    expect(topics.status).toBe(200);
    expect(topics.body.topics).toHaveLength(15);
    expect(topics.body.pendingCount).toBe(15);
    for (const topic of topics.body.topics) {
      expect(topic.approved).toBeNull();
      expect(topic.pendingVersions).toEqual([1]);
    }

    for (const lesson of lessonList.body.lessons) {
      const detail = await browserApi(admin.page, "GET", `/api/studio/lessons/${lesson.lessonId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.pendingRevision).toMatchObject({ version: 1 });
      expect(detail.body.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(detail.body.learnerVideo).toBeNull();
      const approved = await browserApi(admin.page, "POST", `/api/studio/lessons/${lesson.lessonId}`, {
        decision: "approve", confirmedRead: true,
        contentFingerprint: detail.body.contentFingerprint,
        note: "Explicitly reviewed content fixture for browser scenarios.",
      });
      expect(approved.status, lesson.lessonId).toBe(200);
      expect(approved.body.approval).toMatchObject({ status: "approved", baseline: false });
      // Text approval cannot silently approve its external media.
      expect(approved.body.learnerVideo).toBeNull();
      const mediaDetail = await browserApi(admin.page, "GET", `/api/studio/lessons/${lesson.lessonId}`);
      expect(mediaDetail.status).toBe(200);
      expect(mediaDetail.body.contentFingerprint).toBe(detail.body.contentFingerprint);
      const media = await browserApi(admin.page, "POST", "/api/studio/video-reviews", {
        lessonId: lesson.lessonId, status: "approved", captionsStatus: "available",
        videoId: mediaDetail.body.snapshot.lesson.video.id,
        contentFingerprint: mediaDetail.body.contentFingerprint,
        suitabilityStatus: "suitable", replacementUrl: "", notes: "Explicit Admin media fixture review.",
      });
      expect([200, 201], lesson.lessonId).toContain(media.status);
    }
    for (const topic of topics.body.topics) {
      const approved = await browserApi(admin.page, "POST", `/api/topics/${topic.id}/versions/1`, {
        decision: "approve", confirmedRead: true,
        note: "Explicitly reviewed topic fixture for browser scenarios.",
      });
      expect(approved.status, topic.id).toBe(200);
    }
    const published = await browserApi(learner.page, "GET", "/api/curriculum");
    expect(published.status).toBe(200);
    expect(published.body.topics).toHaveLength(15);
    const reviewed = await browserApi(admin.page, "GET", "/api/studio/lessons");
    expect(reviewed.body.lessons).toHaveLength(18);
    expect(reviewed.body.lessons.every((lesson: { status: string; baseline: boolean }) => lesson.status === "approved" && lesson.baseline === false)).toBe(true);
    await learner.page.goto("/adventure?module=hello-me");
    await expect(learner.page.getByRole("dialog", { name: "Full curriculum lesson" })).toBeVisible();
  } finally {
    await learner.context.close();
    await admin.context.close();
  }
});
