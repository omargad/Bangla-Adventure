import { test, expect } from "@playwright/test";
import { createFixtureAccount } from "./helpers/content-fixtures";

test("a video decision submits the exact viewed candidate and displays a stale-revision refusal", async ({ browser, baseURL }) => {
  const { context, page } = await createFixtureAccount(browser, baseURL, "admin", "StoredVideoReview");
  const viewedFingerprint = "a".repeat(64);
  const viewedVideo = { id: "RJ34xfoHJC8", title: "Stored revision greeting video", channel: "Stored source credit", duration: "1:31", reason: "Stored review candidate" };
  let submitted: { videoId?: string; contentFingerprint?: string } | undefined;
  try {
    await page.route("**/api/studio/lessons/numbers-colours", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const detail = await response.json();
      detail.snapshot.lesson.video = viewedVideo;
      detail.contentFingerprint = viewedFingerprint;
      detail.candidateVideo = viewedVideo;
      await route.fulfill({ response, json: detail });
    });
    await page.route("**/api/studio/video-reviews", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 409, json: { error: "The lesson changed. Refresh the preview before reviewing this video.", errorBn: "পাঠটি বদলেছে। ভিডিও পর্যালোচনার আগে প্রিভিউ আবার খুলুন।" } });
    });
    await page.goto("/studio?lesson=numbers-colours");
    const panel = page.getByRole("region", { name: "Video check", exact: true });
    await expect(panel.getByText(viewedVideo.title, { exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Watch on YouTube ↗", exact: true })).toHaveAttribute("href", `https://www.youtube.com/watch?v=${viewedVideo.id}`);
    await panel.getByRole("button", { name: "Save video check", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText("The lesson changed. Refresh the preview before reviewing this video.");
    expect(submitted).toMatchObject({ videoId: viewedVideo.id, contentFingerprint: viewedFingerprint });
    await expect(panel.getByText("Video check saved.", { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
