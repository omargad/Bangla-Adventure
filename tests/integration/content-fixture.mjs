import assert from "node:assert/strict";

const request = (base, route, cookie, body) => fetch(`${base}${route}`, {
  method: body === undefined ? "GET" : "POST", redirect: "manual",
  headers: { cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Test setup uses the same signed-in Admin preview and review APIs as the Studio. */
export async function approveLessonFixture(base, adminCookie, lessonId) {
  const preview = await request(base, `/api/studio/lessons/${lessonId}`, adminCookie);
  assert.equal(preview.status, 200, `Admin previews ${lessonId}`);
  const detail = await preview.json();
  assert.ok(detail.snapshot && detail.contentFingerprint, `Current lesson snapshot for ${lessonId}`);
  const reviewed = await request(base, `/api/studio/lessons/${lessonId}`, adminCookie, {
    decision: "approve", confirmedRead: true, contentFingerprint: detail.contentFingerprint,
    note: "Integration fixture: reviewed the current English and Bangla lesson snapshot.",
  });
  assert.equal(reviewed.status, 200, `Admin approves ${lessonId}: ${await reviewed.text()}`);
}

export async function approveTopicFixture(base, adminCookie, topicId, version) {
  const preview = await request(base, `/api/topics/${topicId}/versions/${version}`, adminCookie);
  assert.equal(preview.status, 200, `Admin previews ${topicId} version ${version}`);
  const detail = await preview.json();
  assert.equal(detail.version.version, version);
  assert.ok(detail.version.content.title.en && detail.version.content.title.bn);
  const reviewed = await request(base, `/api/topics/${topicId}/versions/${version}`, adminCookie, {
    decision: "approve", confirmedRead: true,
  });
  assert.equal(reviewed.status, 200, `Admin approves ${topicId} version ${version}: ${await reviewed.text()}`);
}

/** Bind a media decision to the exact candidate the Admin previewed. Overrides allow stale-preview tests. */
export async function currentVideoReviewFixture(base, adminCookie, lessonId, overrides = {}) {
  const preview = await request(base, `/api/studio/lessons/${lessonId}`, adminCookie);
  assert.equal(preview.status, 200, `Admin previews media for ${lessonId}`);
  const detail = await preview.json();
  assert.ok(detail.contentFingerprint && detail.snapshot.lesson.video.id);
  return {
    lessonId, videoId: detail.snapshot.lesson.video.id, contentFingerprint: detail.contentFingerprint,
    status: "approved", captionsStatus: "available", suitabilityStatus: "suitable", replacementUrl: "", notes: "",
    ...overrides,
  };
}

/** Fresh databases ship pending; published-scenario fixtures explicitly review their contents. */
export async function approveShippedFixtureContent(base, adminCookie, { lessons = true, topics = true, excludeLessons = [] } = {}) {
  if (lessons) {
    const response = await request(base, "/api/studio/lessons", adminCookie);
    assert.equal(response.status, 200);
    const list = (await response.json()).lessons;
    assert.equal(list.length, 18, "All shipped lesson candidates exist");
    for (const lesson of list) {
      if (!excludeLessons.includes(lesson.lessonId) && (lesson.status !== "approved" || lesson.pendingRevision !== null)) {
        await approveLessonFixture(base, adminCookie, lesson.lessonId);
      }
    }
  }
  if (topics) {
    const response = await request(base, "/api/topics", adminCookie);
    assert.equal(response.status, 200);
    const list = (await response.json()).topics;
    assert.equal(list.length, 15, "All shipped topic candidates exist");
    for (const topic of list) {
      if (topic.pendingVersions.length) await approveTopicFixture(base, adminCookie, topic.id, topic.pendingVersions.at(-1));
    }
  }
}
