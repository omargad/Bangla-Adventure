import type Database from "better-sqlite3";

export function migrateAccessControl(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const adultColumns = new Set((sqlite.prepare("PRAGMA table_info(adults)").all() as Array<{ name: string }>).map((column) => column.name));
    for (const [name, definition] of [
      ["role", "text NOT NULL DEFAULT 'parent' CHECK (role IN ('parent', 'teacher', 'admin'))"],
      ["status", "text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))"],
      ["teacher_status", "text NOT NULL DEFAULT 'none' CHECK (teacher_status IN ('none', 'pending', 'approved', 'rejected'))"],
      ["teacher_requested_at", "text"],
    ]) {
      if (!adultColumns.has(name)) sqlite.exec(`ALTER TABLE adults ADD COLUMN ${name} ${definition}`);
    }
    const studentColumns = sqlite.prepare("PRAGMA table_info(students)").all() as Array<{ name: string }>;
    if (!studentColumns.some((column) => column.name === "status")) {
      sqlite.exec("ALTER TABLE students ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))");
    }
    sqlite.exec(`CREATE TABLE IF NOT EXISTS user_audit_events (
      id text PRIMARY KEY NOT NULL,
      actor_id text,
      target_id text NOT NULL,
      target_type text NOT NULL,
      action text NOT NULL,
      details_json text NOT NULL DEFAULT '{}',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS user_audit_target_idx ON user_audit_events (target_id);
    CREATE INDEX IF NOT EXISTS adults_access_idx ON adults (role, status, teacher_status);`);
    const enrollmentColumns = sqlite.prepare("PRAGMA table_info(student_class_enrollments)").all() as Array<{ name: string }>;
    if (!enrollmentColumns.some((column) => column.name === "active")) sqlite.exec("ALTER TABLE student_class_enrollments ADD COLUMN active integer NOT NULL DEFAULT 1");
    sqlite.exec(`CREATE TABLE IF NOT EXISTS topic_updates (
      topic_id text PRIMARY KEY NOT NULL, data_json text NOT NULL, version integer NOT NULL DEFAULT 1,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS student_topic_progress (
      student_id text NOT NULL REFERENCES students(id) ON DELETE cascade,
      topic_id text NOT NULL, completed_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS student_topic_progress_unique ON student_topic_progress(student_id, topic_id);`);
  })();
}
