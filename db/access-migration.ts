import type Database from "better-sqlite3";

export function migrateAccessControl(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const adultColumns = new Set((sqlite.prepare("PRAGMA table_info(adults)").all() as Array<{ name: string }>).map((column) => column.name));
    for (const [name, definition] of [
      ["role", "text NOT NULL DEFAULT 'parent' CHECK (role IN ('parent', 'teacher', 'admin'))"],
      ["status", "text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))"],
      ["teacher_status", "text NOT NULL DEFAULT 'none' CHECK (teacher_status IN ('none', 'pending', 'approved', 'rejected'))"],
      ["teacher_requested_at", "text"],
      ["approval_status", "text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'declined'))"],
      ["must_change_password", "integer NOT NULL DEFAULT 0"],
    ]) {
      if (!adultColumns.has(name)) sqlite.exec(`ALTER TABLE adults ADD COLUMN ${name} ${definition}`);
    }
    const studentColumns = sqlite.prepare("PRAGMA table_info(students)").all() as Array<{ name: string }>;
    if (!studentColumns.some((column) => column.name === "status")) {
      sqlite.exec("ALTER TABLE students ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))");
    }
    if (!studentColumns.some((column) => column.name === "must_change_password")) {
      sqlite.exec("ALTER TABLE students ADD COLUMN must_change_password integer NOT NULL DEFAULT 0");
    }
    // Accounts that existed before self sign-up needed approval keep working: the default is approved.
    if (!studentColumns.some((column) => column.name === "approval_status")) {
      sqlite.exec("ALTER TABLE students ADD COLUMN approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'declined'))");
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
    CREATE INDEX IF NOT EXISTS adults_access_idx ON adults (role, status, teacher_status);
    CREATE INDEX IF NOT EXISTS adults_approval_idx ON adults (approval_status);
    CREATE INDEX IF NOT EXISTS students_approval_idx ON students (approval_status);`);
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
    // Class attendance: one mark per student per session date, saved again in place.
    sqlite.exec(`CREATE TABLE IF NOT EXISTS class_attendance (
      id text PRIMARY KEY NOT NULL,
      class_id text NOT NULL REFERENCES classes(id) ON DELETE cascade,
      student_id text NOT NULL REFERENCES students(id) ON DELETE cascade,
      session_date text NOT NULL,
      present integer NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
      recorded_by text REFERENCES adults(id) ON DELETE set null,
      recorded_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS class_attendance_session_unique ON class_attendance (class_id, student_id, session_date);
    CREATE INDEX IF NOT EXISTS class_attendance_student_idx ON class_attendance (student_id);`);
    // Announcements name their audience and author. Posts from before then were shown to students
    // only and were written in the class teacher's name, so they keep both.
    const announcementColumns = new Set((sqlite.prepare("PRAGMA table_info(class_announcements)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!announcementColumns.has("audience")) {
      sqlite.exec("ALTER TABLE class_announcements ADD COLUMN audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'students', 'parents'))");
      sqlite.exec("UPDATE class_announcements SET audience = 'students'");
    }
    if (!announcementColumns.has("author_id")) {
      sqlite.exec("ALTER TABLE class_announcements ADD COLUMN author_id text REFERENCES adults(id) ON DELETE set null");
      // Only a teacher who still exists: a class left pointing at a removed adult (edited with foreign
      // keys off) leaves its posts without an author instead of failing the whole migration.
      sqlite.exec(`UPDATE class_announcements SET author_id = (
        SELECT classes.teacher_id FROM classes JOIN adults ON adults.id = classes.teacher_id WHERE classes.id = class_announcements.class_id
      )`);
    }
    // Learner profiles were created with SQLite's 'YYYY-MM-DD HH:MM:SS' but edited with ISO times, and the
    // list sorts by updated_at as text. Rewrite the old form as ISO UTC; a value SQLite cannot read stays as it is.
    for (const column of ["created_at", "updated_at"]) {
      sqlite.exec(`UPDATE learner_profiles SET ${column} = strftime('%Y-%m-%dT%H:%M:%fZ', ${column})
        WHERE instr(${column}, 'T') = 0 AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS NOT NULL`);
    }
  })();
}
