import type Database from "better-sqlite3";
import { topics } from "../app/topics-content";
import { contentFingerprint, shippedLessonSnapshots } from "../lib/lesson-content";
import legacyBaseline from "./content-baseline-9ca8.json";

/** Freeze the pre-versioning release once. Subsequent source changes are proposals, never publication. */
export function migrateShippedContent(sqlite: Database.Database, legacyInstallation: boolean): void {
  sqlite.transaction(() => {
    // A new candidate's video review must not overwrite the same Admin's
    // decision on the still-published previous video. This is a named index;
    // all media rows and their identifiers stay intact during the change.
    const videoIndex = sqlite.prepare("PRAGMA index_info(video_reviews_lesson_unique)").all() as Array<{ name: string }>;
    if (videoIndex.map((column) => column.name).join(",") !== "owner_email,lesson_id,video_id") {
      sqlite.exec("DROP INDEX IF EXISTS video_reviews_lesson_unique; CREATE UNIQUE INDEX video_reviews_lesson_unique ON video_reviews(owner_email, lesson_id, video_id)");
    }
    sqlite.exec(`CREATE TABLE IF NOT EXISTS shipped_content_state (
      content_type text NOT NULL, content_id text NOT NULL, baseline_json text,
      last_source_fingerprint text NOT NULL, PRIMARY KEY (content_type, content_id)
    );
    CREATE TABLE IF NOT EXISTS lesson_versions (
      id text PRIMARY KEY NOT NULL, lesson_id text NOT NULL, version integer NOT NULL,
      data_json text NOT NULL, fingerprint text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','approved','rejected','superseded')),
      baseline integer NOT NULL DEFAULT 0, created_at text NOT NULL,
      reviewed_by text REFERENCES adults(id) ON DELETE SET NULL, reviewed_at text,
      review_note text NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lesson_versions_revision ON lesson_versions (lesson_id, version);`);
    const state = sqlite.prepare("SELECT baseline_json, last_source_fingerprint FROM shipped_content_state WHERE content_type = ? AND content_id = ?");
    const insertState = sqlite.prepare("INSERT INTO shipped_content_state (content_type, content_id, baseline_json, last_source_fingerprint) VALUES (?, ?, ?, ?)");
    const updateState = sqlite.prepare("UPDATE shipped_content_state SET last_source_fingerprint = ? WHERE content_type = ? AND content_id = ?");
    const now = new Date().toISOString();
    for (const topic of topics) {
      const { id, ...content } = topic;
      const hash = contentFingerprint(content);
      let stored = state.get("topic", id) as { last_source_fingerprint: string } | undefined;
      if (!stored) {
        const legacy = legacyInstallation ? legacyBaseline.topics.find((item) => item.id === id) : undefined;
        const baseline = legacy ? Object.fromEntries(Object.entries(legacy).filter(([key]) => key !== "id")) : null;
        const baselineHash = baseline ? contentFingerprint(baseline) : "";
        insertState.run("topic", id, legacy ? JSON.stringify(legacy) : null, baselineHash);
        stored = { last_source_fingerprint: baselineHash };
      }
      if (stored.last_source_fingerprint === hash) continue;
      const latest = sqlite.prepare("SELECT MAX(version) AS version FROM topic_versions WHERE topic_id = ?").get(id) as { version: number | null };
      const approved = sqlite.prepare("SELECT version FROM topic_versions WHERE topic_id = ? AND status = 'approved'").get(id) as { version: number } | undefined;
      sqlite.prepare("INSERT INTO topic_versions (id, topic_id, version, data_json, status, based_on, created_at, review_note) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)")
        .run(crypto.randomUUID(), id, (latest.version ?? 0) + 1, JSON.stringify(content), approved?.version ?? 0, now, "Shipped content revision: individual Admin review required.");
      updateState.run(hash, "topic", id);
    }
    for (const snapshot of shippedLessonSnapshots()) {
      const id = snapshot.lesson.id, hash = contentFingerprint(snapshot);
      let stored = state.get("lesson", id) as { last_source_fingerprint: string } | undefined;
      if (!stored) {
        const legacy = legacyInstallation ? legacyBaseline.lessons.find((item) => item.lesson.id === id) : undefined;
        const baselineHash = legacy ? contentFingerprint(legacy) : "";
        insertState.run("lesson", id, legacy ? JSON.stringify(legacy) : null, baselineHash);
        if (legacy) {
          const decision = sqlite.prepare("SELECT baseline, changed_by, changed_at FROM content_approvals WHERE content_type = 'lesson' AND content_id = ? AND status = 'approved' ORDER BY rowid DESC LIMIT 1").get(id) as { baseline: number; changed_by: string | null; changed_at: string } | undefined;
          sqlite.prepare("INSERT INTO lesson_versions (id, lesson_id, version, data_json, fingerprint, status, baseline, created_at, reviewed_by, reviewed_at) VALUES (?, ?, 0, ?, ?, 'approved', ?, ?, ?, ?)")
            .run(crypto.randomUUID(), id, JSON.stringify(legacy), baselineHash, decision?.baseline ?? 1, now, decision?.baseline ? null : decision?.changed_by ?? null, decision?.baseline ? null : decision?.changed_at ?? null);
        }
        stored = { last_source_fingerprint: baselineHash };
      }
      if (stored.last_source_fingerprint === hash) continue;
      const latest = sqlite.prepare("SELECT MAX(version) AS version FROM lesson_versions WHERE lesson_id = ?").get(id) as { version: number | null };
      sqlite.prepare("INSERT INTO lesson_versions (id, lesson_id, version, data_json, fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
        .run(crypto.randomUUID(), id, (latest.version ?? 0) + 1, JSON.stringify(snapshot), hash, now);
      updateState.run(hash, "lesson", id);
    }
  })();
}
