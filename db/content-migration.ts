import type Database from "better-sqlite3";
import { topics } from "../app/topics-content";

const BASELINE_NOTE = "Edited before topic approval existed; approved as a baseline.";

/**
 * Content approval and authoring. Every new or edited topic is stored as a
 * version and only an approved version reaches learners. The topics shipped in
 * app/topics-content.ts are the approved baseline (version 0). Administrator
 * edits saved before approval existed (topic_updates) were already visible to
 * students, so they are carried over once as approved baseline versions.
 * Runs on every start and is safe to repeat.
 */
export function migrateContent(sqlite: Database.Database): void {
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
      for (const [name, definition] of [["quiz_best_score", "integer"], ["quiz_total", "integer"], ["quiz_completed_at", "text"]]) {
        if (!progressColumns.has(name)) sqlite.exec(`ALTER TABLE student_topic_progress ADD COLUMN ${name} ${definition}`);
      }
    }

    if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic_updates'").get()) return;
    const edits = sqlite.prepare("SELECT topic_id, data_json, version, updated_at FROM topic_updates").all() as Array<{ topic_id: string; data_json: string; version: number; updated_at: string }>;
    const hasVersions = sqlite.prepare("SELECT 1 FROM topic_versions WHERE topic_id = ? LIMIT 1");
    const insert = sqlite.prepare(`INSERT INTO topic_versions (id, topic_id, version, data_json, status, baseline, based_on, created_at, reviewed_at, review_note)
      VALUES (?, ?, ?, ?, 'approved', 1, 0, ?, ?, ?)`);
    for (const edit of edits) {
      const shipped = topics.find((topic) => topic.id === edit.topic_id);
      if (!shipped || hasVersions.get(edit.topic_id)) continue;
      const carried = carriedEdit(edit.data_json);
      if (!carried) continue;
      // These edits could change only the reading text, so the category, quiz and sources come from the shipped topic.
      const data = JSON.stringify({ ...shipped, ...carried, id: undefined });
      insert.run(crypto.randomUUID(), edit.topic_id, Math.max(1, edit.version), data, edit.updated_at, edit.updated_at, BASELINE_NOTE);
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
