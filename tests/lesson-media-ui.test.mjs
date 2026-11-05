import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { VideoCheck } = await import("../app/studio/LessonMedia.tsx");
const sourceVideo = { id: "RJ34xfoHJC8", title: "Stored revision greeting video", channel: "Stored source credit", duration: "1:31", reason: "Stored review candidate" };
const props = {
  lessonId: "numbers-colours", sourceVideo, candidateVideoId: sourceVideo.id,
  contentFingerprint: "a".repeat(64), language: "en", check: null, learnerVideo: null, canApprove: true, onChanged() {},
};

test("the video review renders the viewed stored candidate rather than the current static lesson video", () => {
  const html = renderToStaticMarkup(createElement(VideoCheck, props));
  assert.ok(html.includes(sourceVideo.title));
  assert.ok(html.includes(sourceVideo.channel));
  assert.ok(html.includes(`href="https://www.youtube.com/watch?v=${sourceVideo.id}"`));
  assert.ok(!html.includes("J4PMaaG6TJ0"), "the numbers lesson's raw current video must not replace the stored candidate");
  assert.doesNotMatch(html, /disabled=""[^>]*>Save video check/);
});

test("an inconsistent video candidate cannot submit a decision", () => {
  const html = renderToStaticMarkup(createElement(VideoCheck, { ...props, candidateVideoId: "uHTorwKsVFg" }));
  assert.ok(html.includes("Refresh the lesson preview before reviewing this video."));
  assert.match(html, /disabled=""[^>]*>Save video check/);
});

test("a newer candidate does not claim that learners already see its different video", () => {
  const publishedVideo = { ...sourceVideo, id: "J4PMaaG6TJ0", title: "Previously published video" };
  const html = renderToStaticMarkup(createElement(VideoCheck, { ...props, learnerVideo: publishedVideo }));
  assert.ok(html.includes("Learners still use the video from an earlier approved lesson revision."));
  assert.ok(!html.includes("Learners see this video."));
  assert.ok(html.includes(sourceVideo.title), "the review panel still shows the candidate being reviewed");
});
