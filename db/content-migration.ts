import type Database from "better-sqlite3";
import { checkStoredLinks, type SourceOverride } from "../lib/library-links";
import { migrateShippedContent } from "./shipped-content-migration";
import legacyBaseline from "./content-baseline-9ca8.json";

const BASELINE_NOTE = "Edited before topic approval existed; approved as a baseline.";

/** Content schema and policy migrations. Pre-versioning publication decisions
 * are retained; shipped snapshots and new candidates are added atomically.
 * A fresh install starts entirely pending. Repeated startup is idempotent. */
export function migrateContent(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    // Classify before creating approval tables. A populated pre-approval app
    // already exposed the old source baseline, whereas an empty/failed fresh
    // installation (or an unrelated decision row) proves no such availability.
    const legacyKind = legacyContentAvailability(sqlite);
    migrateTopics(sqlite);
    migrateLessons(sqlite, legacyKind === "pre-approval");
    migrateClassSources(sqlite);
    migrateLibraryLinks(sqlite);
    migrateAdminContentApproval(sqlite);
    migrateShippedContent(sqlite, legacyKind !== null);
    migrateApprovalSettings(sqlite);
  })();
}

/**
 * Settings an administrator changes in the app (lib/approval-settings.ts), and which topic versions
 * were published without waiting for a review. Nothing is written: a setting without a row keeps its
 * default, so an existing installation keeps the approvals it had. Safe to repeat.
 */
export function migrateApprovalSettings(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY NOT NULL,
    value_json text NOT NULL,
    updated_by text REFERENCES adults(id) ON DELETE SET NULL,
    updated_at text NOT NULL
  )`);
  const columns = new Set((sqlite.prepare("PRAGMA table_info(topic_versions)").all() as Array<{ name: string }>).map((column) => column.name));
  if (columns.size && !columns.has("published_directly")) {
    sqlite.exec("ALTER TABLE topic_versions ADD COLUMN published_directly text CHECK (published_directly IN ('admin', 'setting'))");
  }
}

function legacyContentAvailability(sqlite: Database.Database): "pre-approval" | "baseline" | null {
  const hasTable = (table: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  if (hasTable("shipped_content_state")) return null;
  if (hasTable("content_approvals")) {
    const ids = legacyBaseline.lessons.map((snapshot) => snapshot.lesson.id);
    return sqlite.prepare(`SELECT 1 FROM content_approvals WHERE content_type='lesson' AND status IN ('approved','withdrawn') AND content_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`).get(...ids) ? "baseline" : null;
  }
  const historicalTables = ["adults", "students", "learner_profiles", "skill_progress", "assignments", "classes", "class_students", "class_activities", "student_class_enrollments", "student_topic_progress", "topic_updates", "curriculum_drafts", "content_reviews", "media_assets", "video_reviews"];
  return historicalTables.some((table) => hasTable(table) && sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) ? "pre-approval" : null;
}

/** Apply the administrator publication boundary once, without deleting authored work or results. */
export function migrateAdminContentApproval(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const hasTable = (name: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
    const addColumns = (table: string, definitions: Array<[string, string]>) => {
      if (!hasTable(table)) return;
      const present = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
      for (const [name, definition] of definitions) if (!present.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    const reviewColumns: Array<[string, string]> = [
      ["approval_status", "text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected'))"],
      ["revision", "integer NOT NULL DEFAULT 1"],
      ["reviewed_by", "text REFERENCES adults(id) ON DELETE SET NULL"],
      ["reviewed_at", "text"],
      ["review_note", "text NOT NULL DEFAULT ''"],
    ];
    addColumns("class_activities", [...reviewColumns, ["created_by", "text REFERENCES adults(id) ON DELETE SET NULL"]]);
    // SQLite cannot add a column with CURRENT_TIMESTAMP as a nonconstant default.
    addColumns("class_sources", [...reviewColumns, ["updated_at", "text NOT NULL DEFAULT ''"]]);
    addColumns("video_reviews", [["admin_decided_at", "text"]]);
    addColumns("media_assets", [["reviewed_by", "text REFERENCES adults(id) ON DELETE SET NULL"], ["reviewed_at", "text"]]);
    sqlite.exec("CREATE TABLE IF NOT EXISTS content_migration_versions (id text PRIMARY KEY NOT NULL, applied_at text NOT NULL)");
    const migration = "admin_content_approval_v1";
    if (sqlite.prepare("SELECT 1 FROM content_migration_versions WHERE id = ?").get(migration)) return;

    const now = new Date().toISOString();
    const note = "Held for administrator review after the publication approval policy changed.";
    const roleHistory = hasTable("user_audit_events") ? sqlite.prepare("SELECT action, details_json, created_at, rowid AS sequence FROM user_audit_events WHERE target_type = 'adult' AND target_id = ? ORDER BY rowid") : null;
    const timestamp = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
    // A current role never proves a past role. Require a prior audited grant or
    // role snapshot; coarse timestamps within the decision's second are uncertain.
    const wasAdminAt = (id: unknown, decisionAt: unknown) => {
      if (typeof id !== "string" || typeof decisionAt !== "string" || !roleHistory) return false;
      const at = timestamp(decisionAt);
      if (!Number.isFinite(at)) return false;
      const history = roleHistory.all(id) as Array<{ action: string; details_json: string; created_at: string; sequence: number }>;
      const roles: Array<{ role: string | null; at: number; sequence: number }> = [];
      for (const event of history) {
        let role: string | null | undefined;
        if (event.action === "administrator-granted-by-server-operator") role = "admin";
        else {
          try {
            const details = JSON.parse(event.details_json);
            if (details && ["parent", "teacher", "admin"].includes(details.role)) role = details.role;
          } catch { /* Malformed account-management evidence cannot prove a role. */ }
          if (role === undefined && ["update", "approve", "reject", "account-approved", "account-declined", "revoke-sessions"].includes(event.action)) role = null;
        }
        if (role === undefined) continue;
        const time = timestamp(event.created_at);
        if (!Number.isFinite(time)) return false;
        if (time <= at) roles.push({ role, at: time, sequence: event.sequence });
      }
      roles.sort((left, right) => left.at - right.at || left.sequence - right.sequence);
      const latest = roles.at(-1);
      return Boolean(latest && at - latest.at >= 1000 && latest.role === "admin");
    };
    const audit = hasTable("user_audit_events") ? sqlite.prepare("INSERT INTO user_audit_events (id, actor_id, target_id, target_type, action, details_json) VALUES (?, NULL, ?, ?, 'admin-approval-required', ?)") : null;
    const recordHold = (id: string, type: string, previous: unknown) => audit?.run(crypto.randomUUID(), id, type, JSON.stringify({ reason: note, previous }));

    // No historical class approval existed. Creator role is not an approval decision.
    for (const table of ["class_activities", "class_sources"]) {
      if (!hasTable(table)) continue;
      const rows = sqlite.prepare(`SELECT id, reviewed_by, reviewed_at, review_note, approval_status FROM ${table}`).all() as Array<{ id: string }>;
      for (const row of rows) recordHold(row.id, table === "class_activities" ? "class-activity" : "class-source", row);
      sqlite.exec(`UPDATE ${table} SET approval_status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = ''`);
    }
    if (hasTable("class_sources")) sqlite.exec("UPDATE class_sources SET updated_at = created_at WHERE updated_at = ''");

    if (hasTable("topic_versions")) {
      const rows = sqlite.prepare("SELECT id, topic_id, version, baseline, reviewed_by, reviewed_at, review_note FROM topic_versions WHERE status = 'approved'").all() as Array<{ id: string; reviewed_by: string | null; reviewed_at: string | null }>;
      for (const row of rows) if (!wasAdminAt(row.reviewed_by, row.reviewed_at)) {
        // The shipped version zero lives in source code. Stored custom versions stay intact.
        recordHold(row.id, "topic-version", row);
        sqlite.prepare("UPDATE topic_versions SET status = 'pending' WHERE id = ?").run(row.id);
      }
    }
    if (hasTable("media_assets")) {
      const rows = sqlite.prepare("SELECT id, reviewed_by, reviewed_at, review_status FROM media_assets WHERE review_status = 'approved'").all() as Array<{ id: string; reviewed_by: string | null; reviewed_at: string | null }>;
      for (const row of rows) if (!wasAdminAt(row.reviewed_by, row.reviewed_at)) {
        recordHold(row.id, "media", row);
        sqlite.prepare("UPDATE media_assets SET review_status = 'pending' WHERE id = ?").run(row.id);
      }
    }
    if (hasTable("content_approvals")) {
      const rows = sqlite.prepare("SELECT * FROM content_approvals WHERE content_type = 'lesson' AND rowid IN (SELECT MAX(rowid) FROM content_approvals GROUP BY content_type, content_id)").all() as Array<{ id: string; content_id: string; status: string; baseline: number; changed_by: string | null; changed_at: string }>;
      const hold = sqlite.prepare("INSERT INTO content_approvals (id, content_type, content_id, status, baseline, changed_by, changed_at, note) VALUES (?, 'lesson', ?, 'withdrawn', 0, NULL, ?, ?)");
      for (const row of rows) if (row.status === "approved" && !row.baseline && !wasAdminAt(row.changed_by, row.changed_at)) {
        recordHold(row.content_id, "lesson", row);
        hold.run(crypto.randomUUID(), row.content_id, now, note);
      }
      // A teacher's restoration must not override an earlier topic withdrawal.
      const topicDecisions = sqlite.prepare("SELECT * FROM content_approvals WHERE content_type = 'topic' AND rowid IN (SELECT MAX(rowid) FROM content_approvals GROUP BY content_type, content_id)").all() as Array<{ content_id: string; status: string; changed_by: string | null; changed_at: string }>;
      const wasWithdrawn = sqlite.prepare("SELECT 1 FROM content_approvals WHERE content_type = 'topic' AND content_id = ? AND status = 'withdrawn' LIMIT 1");
      const holdTopic = sqlite.prepare("INSERT INTO content_approvals (id, content_type, content_id, status, baseline, changed_by, changed_at, note) VALUES (?, 'topic', ?, 'withdrawn', 0, NULL, ?, ?)");
      for (const row of topicDecisions) if (row.status === "approved" && !wasAdminAt(row.changed_by, row.changed_at) && wasWithdrawn.get(row.content_id)) {
        recordHold(row.content_id, "topic", row);
        holdTopic.run(crypto.randomUUID(), row.content_id, now, note);
      }
    }
    if (hasTable("video_reviews")) {
      const rows = sqlite.prepare("SELECT * FROM video_reviews").all() as Array<{ id: string; owner_email: string; lesson_id: string; status: string; suitability_status: string; replacement_url: string; checked_at: string | null; updated_at: string }>;
      // Retain a prior administrator's actual audited video decision, never infer one from a teacher check.
      const evidence = hasTable("adults") && hasTable("user_audit_events") ? sqlite.prepare("SELECT e.actor_id, e.details_json FROM user_audit_events e JOIN adults a ON a.id = e.actor_id WHERE a.email = ? AND e.target_id = ? AND e.action = 'lesson-video-checked' ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1") : null;
      for (const row of rows) {
        const event = evidence?.get(row.owner_email, row.lesson_id) as { actor_id: string; details_json: string } | undefined;
        let matches = false;
        try {
          const details = event ? JSON.parse(event.details_json) : null;
          matches = Boolean(details && details.status === row.status && details.suitabilityStatus === row.suitability_status && (details.replacementUrl ?? "") === row.replacement_url);
        } catch { /* No reliable prior administrator decision. */ }
        if (matches && row.checked_at && wasAdminAt(event?.actor_id, row.checked_at)) sqlite.prepare("UPDATE video_reviews SET admin_decided_at = ? WHERE id = ?").run(row.checked_at, row.id);
        else recordHold(row.id, "video-review", row);
      }
    }
    sqlite.prepare("INSERT INTO content_migration_versions (id, applied_at) VALUES (?, ?)").run(migration, now);
  })();
}

/**
 * Textbook links saved before only administrators could change them. Any approved
 * teacher could then store any HTTPS link for a book, and it showed only in the
 * textbook library; the same link now replaces the official NCTB pages on Sources &
 * references and in every topic's sources. So each record not yet checked has its
 * links held back from readers when the account that saved it is not an active
 * administrator or a link is not on nctb.gov.bd (see checkStoredLinks), with a
 * library-link-held audit event, until an administrator restores or discards them
 * under "Links to check" on the Sources page. Checked records are marked, so this
 * runs once per record and is safe to repeat.
 */
function migrateLibraryLinks(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_sources'").get()) return;
  sqlite.transaction(() => {
    const rows = sqlite.prepare("SELECT id, updated_by, data_json FROM knowledge_sources").all() as Array<{ id: string; updated_by: string; data_json: string }>;
    const isAdmin = sqlite.prepare("SELECT 1 FROM adults WHERE email = ? AND role = 'admin' AND status = 'active'");
    const save = sqlite.prepare("UPDATE knowledge_sources SET data_json = ? WHERE id = ?");
    const audit = sqlite.prepare("INSERT INTO user_audit_events (id, actor_id, target_id, target_type, action, details_json) VALUES (?, NULL, ?, 'library-source', 'library-link-held', ?)");
    const now = new Date().toISOString();
    for (const row of rows) {
      let stored: SourceOverride;
      try { stored = JSON.parse(row.data_json) as SourceOverride; } catch { continue; }
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
      const next = checkStoredLinks(stored, { email: row.updated_by, admin: Boolean(row.updated_by && isAdmin.get(row.updated_by)) }, now);
      if (!next) continue;
      save.run(JSON.stringify(next), row.id);
      const held = next.heldLinks;
      if (held) audit.run(crypto.randomUUID(), row.id, JSON.stringify({ bookId: row.id, ...(held.downloadUrl ? { downloadUrl: held.downloadUrl } : {}), ...(held.classLinks ? { classLinks: held.classLinks } : {}), setBy: held.setBy, reasons: held.reasons }));
    }
  })();
}

/** Per-class sources: links a class's teacher adds for that class only. Safe to repeat. */
function migrateClassSources(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS class_sources (
    id text PRIMARY KEY NOT NULL,
    class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    title_en text NOT NULL DEFAULT '',
    title_bn text NOT NULL DEFAULT '',
    url text NOT NULL,
    note text NOT NULL DEFAULT '',
    created_by text REFERENCES adults(id) ON DELETE SET NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS class_sources_class_idx ON class_sources (class_id);`);
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
      const shipped = legacyBaseline.topics.find((topic) => topic.id === edit.topic_id);
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

/**
 * The shared teacher approval of the 18 lessons. content_approvals keeps one row
 * per decision; the newest row (by rowid) is the lesson's current state, and only
 * approved lessons reach learners. Existing publication rows are preserved; fresh
 * installations have no approved rows and wait for individual Admin decisions. Human audio records who approved it.
 * Runs on every start and is safe to repeat.
 */
function migrateLessons(sqlite: Database.Database, inheritPreApprovalBaseline: boolean): void {
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
    // Existing decisions are retained. Fresh installs never manufacture an
    // approval for content merely because it was included in the source tree.
    if (inheritPreApprovalBaseline) {
      const insert = sqlite.prepare("INSERT INTO content_approvals (id,content_type,content_id,status,baseline,changed_at,note) VALUES (?, 'lesson', ?, 'approved', 1, ?, ?)");
      const now = new Date().toISOString();
      for (const snapshot of legacyBaseline.lessons) insert.run(crypto.randomUUID(), snapshot.lesson.id, now, "Retained pre-approval legacy availability; individual Admin review remains pending.");
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
