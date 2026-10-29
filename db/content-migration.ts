import type Database from "better-sqlite3";
import { topics } from "../app/topics-content";

const BASELINE_NOTE = "Edited before topic approval existed; approved as a baseline.";

/**
 * Content approval and authoring: topic versions (below) and the shared lesson
 * approval (migrateLessons). Every new or edited topic is stored as a
 * version and only an approved version reaches learners. The topics shipped in
 * app/topics-content.ts are the approved baseline (version 0). Administrator
 * edits saved before approval existed (topic_updates) were already visible to
 * students, so they are carried over once as approved baseline versions, credited
 * to the administrator who saved them while that account exists.
 * Runs on every start and is safe to repeat.
 */
export function migrateContent(sqlite: Database.Database): void {
  migrateTopics(sqlite);
  migrateLessons(sqlite);
}

function migrateTopics(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS topic_versions (
      id text PRIMARY KEY NOT NULL,
      topic_id text NOT NULL,
      version integer NOT NULL,
      data_json text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
      baseline integer NOT NULL DEFAULT 0,
      based_on integer,
      created_by text REFERENCES adults(id) ON DELETE SET NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_by text REFERENCES adults(id) ON DELETE SET NULL,
      reviewed_at text,
      review_note text NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS topic_versions_topic_version_unique ON topic_versions (topic_id, version);
    CREATE INDEX IF NOT EXISTS topic_versions_status_idx ON topic_versions (status);`);

    const progressColumns = new Set((sqlite.prepare("PRAGMA table_info(student_topic_progress)").all() as Array<{ name: string }>).map((column) => column.name));
    if (progressColumns.size) {
      for (const [name, definition] of [["quiz_best_score", "integer"], ["quiz_total", "integer"], ["quiz_key", "text"], ["quiz_completed_at", "text"]]) {
        if (!progressColumns.has(name)) sqlite.exec(`ALTER TABLE student_topic_progress ADD COLUMN ${name} ${definition}`);
      }
    }

    if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic_updates'").get()) return;
    const edits = sqlite.prepare("SELECT topic_id, data_json, version, updated_at FROM topic_updates").all() as Array<{ topic_id: string; data_json: string; version: number; updated_at: string }>;
    const hasVersions = sqlite.prepare("SELECT 1 FROM topic_versions WHERE topic_id = ? LIMIT 1");
    const insert = sqlite.prepare(`INSERT INTO topic_versions (id, topic_id, version, data_json, status, baseline, based_on, created_by, created_at, reviewed_at, review_note)
      VALUES (?, ?, ?, ?, 'approved', 1, 0, ?, ?, ?, ?)`);
    // The old editor audited every save; the latest save wrote the stored text.
    const hasAudit = Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_audit_events'").get());
    const lastEditor = hasAudit ? sqlite.prepare(`SELECT adults.id FROM (
        SELECT actor_id FROM user_audit_events WHERE action = 'topic-preview-updated' AND target_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) AS latest JOIN adults ON adults.id = latest.actor_id`) : null;
    const credit = sqlite.prepare("UPDATE topic_versions SET created_by = ? WHERE topic_id = ? AND version = ? AND baseline = 1 AND created_by IS NULL AND review_note = ?");
    for (const edit of edits) {
      const shipped = topics.find((topic) => topic.id === edit.topic_id);
      if (!shipped) continue;
      const author = (lastEditor?.get(edit.topic_id) as { id: string } | undefined)?.id ?? null;
      const version = Math.max(1, edit.version);
      if (hasVersions.get(edit.topic_id)) {
        // Carried over before authors were credited.
        if (author) credit.run(author, edit.topic_id, version, BASELINE_NOTE);
        continue;
      }
      const carried = carriedEdit(edit.data_json);
      if (!carried) continue;
      // These edits could change only the reading text, so the category, quiz and sources come from the shipped topic.
      const data = JSON.stringify({ ...shipped, ...carried, id: undefined });
      insert.run(crypto.randomUUID(), edit.topic_id, version, data, author, edit.updated_at, edit.updated_at, BASELINE_NOTE);
    }
  })();
}

/** The 18 lessons students could already open before lesson approval existed. */
const BASELINE_LESSONS = [
  "hello-me", "my-family", "numbers-colours", "letters-sounds", "food-please", "my-day", "school-home", "directions", "six-seasons",
  "river-journey", "sundarbans-voices", "friendship-help", "language-movement", "heritage-comparison", "living-arts", "two-homes", "poetry-place", "research-exhibition",
];

/**
 * The shared teacher approval of the 18 lessons. content_approvals keeps one row
 * per decision; the newest row (by rowid) is the lesson's current state, and only
 * approved lessons reach learners. The lessons students already used start as
 * approved baseline rows, so nothing disappears when approval starts; a lesson
 * with no row waits for approval. Human audio records who approved it.
 * Runs on every start and is safe to repeat.
 */
function migrateLessons(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS content_approvals (
      id text PRIMARY KEY NOT NULL,
      content_type text NOT NULL,
      content_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('approved', 'withdrawn')),
      baseline integer NOT NULL DEFAULT 0,
      changed_by text REFERENCES adults(id) ON DELETE SET NULL,
      changed_at text NOT NULL,
      note text NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS content_approvals_item_idx ON content_approvals (content_type, content_id);`);
    const hasRecord = sqlite.prepare("SELECT 1 FROM content_approvals WHERE content_type = 'lesson' AND content_id = ? LIMIT 1");
    const baseline = sqlite.prepare("INSERT INTO content_approvals (id, content_type, content_id, status, baseline, changed_at) VALUES (?, 'lesson', ?, 'approved', 1, ?)");
    const now = new Date().toISOString();
    for (const lessonId of BASELINE_LESSONS) {
      if (!hasRecord.get(lessonId)) baseline.run(crypto.randomUUID(), lessonId, now);
    }

    const mediaColumns = new Set((sqlite.prepare("PRAGMA table_info(media_assets)").all() as Array<{ name: string }>).map((column) => column.name));
    if (mediaColumns.size) {
      if (!mediaColumns.has("reviewed_by")) sqlite.exec("ALTER TABLE media_assets ADD COLUMN reviewed_by text REFERENCES adults(id) ON DELETE SET NULL");
      if (!mediaColumns.has("reviewed_at")) sqlite.exec("ALTER TABLE media_assets ADD COLUMN reviewed_at text");
    }
  })();
}

const isPair = (value: unknown): value is { en: string; bn: string } =>
  Boolean(value) && typeof (value as { en?: unknown }).en === "string" && typeof (value as { bn?: unknown }).bn === "string";

function carriedEdit(json: string) {
  try {
    const stored = JSON.parse(json);
    if (!isPair(stored.title) || !isPair(stored.tagline) || !Number.isInteger(stored.minutes) || !Array.isArray(stored.sections)) return null;
    if (!stored.sections.length || !stored.sections.every((section: { heading?: unknown; body?: unknown }) => isPair(section?.heading) && isPair(section?.body))) return null;
    return { title: stored.title, tagline: stored.tagline, minutes: stored.minutes, sections: stored.sections };
  } catch {
    return null;
  }
}
