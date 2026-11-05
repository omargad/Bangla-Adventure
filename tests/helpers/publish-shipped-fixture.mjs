import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { bootstrapSql } from "../../db/bootstrap.ts";

export const legacyContent = JSON.parse(readFileSync(new URL("../../db/content-baseline-9ca8.json", import.meta.url), "utf8"));

/** Reproduce real pre-versioning lesson decisions, without reviewing newer source content. */
export function seedLegacyLessonApprovals(sqlite) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS content_approvals (
    id text PRIMARY KEY NOT NULL, content_type text NOT NULL, content_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('approved','withdrawn')), baseline integer NOT NULL DEFAULT 0,
    changed_by text REFERENCES adults(id) ON DELETE SET NULL, changed_at text NOT NULL, note text NOT NULL DEFAULT ''
  )`);
  const insert = sqlite.prepare("INSERT OR IGNORE INTO content_approvals (id, content_type, content_id, status, baseline, changed_at, note) SELECT ?, 'lesson', ?, 'approved', 1, '2026-10-01T00:00:00.000Z', 'Published before lesson versioning; inherited baseline.' WHERE NOT EXISTS (SELECT 1 FROM content_approvals WHERE content_type = 'lesson' AND content_id = ?)");
  for (const { lesson } of legacyContent.lessons) insert.run(`legacy-baseline-${lesson.id}`, lesson.id, lesson.id);
}

/** Set up an on-disk old installation before the application's real startup migrations. */
export function createLegacyContentFixture(databasePath) {
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(bootstrapSql);
    seedLegacyLessonApprovals(sqlite);
  } finally { sqlite.close(); }
}

/** Publish fresh shipped fixtures through the same explicit Admin review functions as production. */
export async function publishShippedFixtures(adminId, { topics = true, lessons = true } = {}) {
  if (topics) {
    const catalog = await import("../../lib/curriculum-catalog.ts");
    for (const topic of await catalog.listStaffTopics()) {
      const pendingVersion = topic.pendingVersions.at(-1);
      if (pendingVersion !== undefined) await catalog.reviewTopicVersion(adminId, topic.id, pendingVersion, { decision: "approve", confirmedRead: true });
    }
  }
  if (lessons) {
    const approval = await import("../../lib/lesson-approval.ts");
    for (const lesson of (await approval.lessonStudioList()).lessons) {
      const detail = await approval.lessonStudioDetail(lesson.lessonId);
      if (detail.pendingRevision) await approval.decideLesson(adminId, lesson.lessonId, { decision: "approve", confirmedRead: true, contentFingerprint: detail.contentFingerprint });
    }
  }
}
