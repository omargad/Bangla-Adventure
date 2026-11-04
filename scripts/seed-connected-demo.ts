/** Operator-only fixture. No HTTP endpoint, credentials, session changes or deletes. */
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrapSql } from "../db/bootstrap";
import { migrateAccessControl } from "../db/access-migration";
import { migrateContent } from "../db/content-migration";
import { hashPassword, hashSessionToken } from "../lib/password";
import { gradeAnswers, validateQuizQuestions } from "../lib/classroom";
import { topics } from "../app/topics-content";

export const DEMO_ID = "connected-demo-2026-11-v1";
const id = (key: string) => `${DEMO_ID}:${key}`;
type Row = Record<string, string | number | null>;
type Options = { mode: "local" | "live"; apply?: boolean; localPassword?: string; date?: string };
const roster = [
  ["maya", "Maya Rahman"], ["arif", "Arif Hasan"], ["nadia", "Nadia Islam"],
  ["rafi", "Rafi Ahmed"], ["zara", "Zara Chowdhury"],
];
const units = [
  { topic: "national-symbols", title: "1. Our Bangladesh: symbols and identity", day: -14, closed: true },
  { topic: "rivers-everyday-life", title: "2. River journeys: life beside the water", day: -7, closed: true },
  { topic: "pohela-boishakh", title: "3. A new year together: Pohela Boishakh", day: -2, closed: true },
  { topic: "crafts-of-bengal", title: "4. Our heritage showcase: crafts of Bengal", day: -1, closed: false },
];

export async function seedConnectedDemo(file: string, options: Options) {
  if (!file || file === ":memory:") throw new Error("Use an explicit persistent database path.");
  const fresh = !existsSync(file);
  if (options.mode === "live" && fresh) throw new Error("Live database must already exist; refusing to create one.");
  if (options.mode === "local" && !fresh) throw new Error("Local bootstrap requires a fresh file. Test repeat runs in live mode.");
  if (options.mode === "local" && (!options.apply || !options.localPassword || options.localPassword.length < 12)) throw new Error("Local bootstrap needs --apply and a private test password of at least 12 characters.");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 10000");
  const baseDate = options.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || Number.isNaN(Date.parse(baseDate))) throw new Error("Invalid scenario date.");
  const when = (offset: number, hour = 2) => {
    const date = new Date(`${baseDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset); date.setUTCHours(hour);
    return date.toISOString();
  };
  const get = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as Row | undefined;
  const insert = (table: string, value: Row) => {
    const keys = Object.keys(value);
    db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(value));
  };
  try {
    if (options.mode === "local") {
      db.exec(bootstrapSql); migrateAccessControl(db); migrateContent(db);
      const passwordHash = hashPassword(options.localPassword!);
      for (const [key, email, name, role] of [
        ["admin", "admin@admin.com", "Admin", "admin"],
        ["teacher", "timmarco@gmail.com", "Tim Marco", "teacher"],
        ["parent", "franksamo@gmail.com", "Frank Samo", "parent"],
      ]) insert("adults", { id: id(key), email, display_name: name, role, teacher_status: role === "teacher" ? "approved" : "none", status: "active", approval_status: "approved", password_hash: passwordHash, created_at: when(-28) });
      insert("students", { id: id("camel"), username: "camel", display_name: "Camel", password_hash: passwordHash, status: "active", approval_status: "approved", created_at: when(-28) });
      insert("classes", { id: id("class"), teacher_id: id("teacher"), name: "Demo Class", join_code: "DM26AB", created_at: when(-21) });
    }
    const markerExists = get("SELECT name FROM sqlite_master WHERE type='table' AND name='demo_seed_runs'");
    const previous = markerExists && get("SELECT * FROM demo_seed_runs WHERE id=?", DEMO_ID);
    if (previous) return { status: "already-applied", runId: DEMO_ID, summary: JSON.parse(String(previous.summary_json)) };
    const admin = get("SELECT * FROM adults WHERE lower(email)=?", "admin@admin.com");
    const teacher = get("SELECT * FROM adults WHERE lower(email)=?", "timmarco@gmail.com");
    const parent = get("SELECT * FROM adults WHERE lower(email)=?", "franksamo@gmail.com");
    const camel = get("SELECT * FROM students WHERE lower(username)=?", "camel");
    for (const [account, role] of [[admin, "admin"], [teacher, "teacher"], [parent, "parent"], [camel, "student"]] as const) {
      if (!account || account.status !== "active" || account.approval_status !== "approved" || account.must_change_password !== 0 || (role !== "student" && account.role !== role)) throw new Error(`Expected approved, active ${role} account is missing or changed; no live data written.`);
    }
    if (teacher!.teacher_status !== "approved") throw new Error("Tim Marco is not an approved teacher.");
    const matches = db.prepare("SELECT * FROM classes WHERE teacher_id=? AND name='Demo Class'").all(teacher!.id) as Row[];
    if (matches.length !== 1) throw new Error("Expected exactly one Demo Class belonging to Tim Marco.");
    const classroom = matches[0];
    if (Number(get("SELECT count(*) AS n FROM class_activities WHERE class_id=?", String(classroom.id))!.n)) throw new Error("Demo Class now has work. Refusing to mix a seed with existing activities.");
    const existingRoster = db.prepare("SELECT e.*, s.username FROM student_class_enrollments e JOIN students s ON s.id=e.student_id WHERE e.class_id=?").all(classroom.id) as Row[];
    if (existingRoster.some(row => row.student_id !== camel!.id || !row.active)) throw new Error("Demo Class roster changed; review before seeding.");
    const priorParentLinks = db.prepare("SELECT * FROM parent_student_links WHERE parent_id=?").all(parent!.id) as Row[];
    if (priorParentLinks.some(row => row.student_id !== camel!.id)) throw new Error("Demo parent has other linked children; review before seeding.");
    const priorAttendance = get("SELECT count(*) AS n FROM class_attendance WHERE class_id=?", String(classroom.id));
    if (Number(priorAttendance!.n)) throw new Error("Demo Class already has attendance; review before seeding.");
    for (const table of ["adults", "students", "class_students", "class_activities", "class_announcements", "class_sources", "user_audit_events"]) {
      // Primary fixtures above are allowed only in the newly bootstrapped local database.
      if (options.mode === "live" && get(`SELECT id FROM ${table} WHERE id LIKE ? LIMIT 1`, `${DEMO_ID}:%`)) throw new Error(`Unmarked demo IDs already exist in ${table}; refusing a partial seed.`);
    }
    for (const [key] of [...roster, ["pending-student", ""]]) if (get("SELECT id FROM students WHERE username=?", `demo.${key}`)) throw new Error("A demo username is already occupied.");
    for (const key of ["pending-parent", "pending-teacher"]) if (get("SELECT id FROM adults WHERE email=?", `${key}@demo.example`)) throw new Error("A demo email is already occupied.");
    const prepared = units.map((unit) => {
      const topic = topics.find(t => t.id === unit.topic);
      if (!topic) throw new Error(`Unknown topic ${unit.topic}`);
      const questions = topic.quiz.map(q => ({ prompt: q.question.en, options: q.options.map(o => o.en), answer: q.answer }));
      const validated = validateQuizQuestions(questions);
      if ("error" in validated) throw new Error(validated.error);
      return { ...unit, topicData: topic, questions: validated.questions };
    });
    const summary = { className: classroom.name, students: 6, pendingAccounts: 3, activities: 4, completedForCamel: 3, camelAttendance: "3/3", date: baseDate };
    if (!options.apply) return { status: "dry-run", runId: DEMO_ID, summary };
    const backupPath = `${file}.before-${DEMO_ID}-${Date.now()}.sqlite`;
    if (options.mode === "live") await db.backup(backupPath);
    // Random discarded passwords make supporting fixtures non-loginable in practice.
    // The four existing demo passwords, roles, and sessions are never changed.
    const fixturePassword = hashPassword(randomBytes(48).toString("base64url"));
    db.transaction(() => {
      // Another process must not apply between preflight and obtaining the write lock.
      if (get("SELECT name FROM sqlite_master WHERE type='table' AND name='demo_seed_runs'") && get("SELECT id FROM demo_seed_runs WHERE id=?", DEMO_ID)) throw new Error("Seed concurrently applied; rerun for status.");
      db.exec("CREATE TABLE IF NOT EXISTS demo_seed_runs (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, summary_json TEXT NOT NULL)");
      const learners: Row[] = [camel!];
      for (const [key, name] of roster) {
        const student = { id: id(`student-${key}`), username: `demo.${key}`, display_name: name, password_hash: fixturePassword, status: "active", approval_status: "approved", must_change_password: 1, created_at: when(-21) };
        insert("students", student); learners.push(student);
      }
      insert("students", { id: id("pending-student"), username: "demo.pending-student", display_name: "Samira Khan (demo applicant)", password_hash: fixturePassword, status: "active", approval_status: "pending", must_change_password: 1, created_at: when(-1) });
      for (const [key, name, requested] of [["pending-parent", "Nusrat Khan (demo parent)", "none"], ["pending-teacher", "Ayesha Rahman (demo teacher)", "pending"]]) insert("adults", { id: id(key), email: `${key}@demo.example`, display_name: name, role: "parent", teacher_status: requested, teacher_requested_at: requested === "pending" ? when(-1) : null, password_hash: fixturePassword, status: "active", approval_status: "pending", must_change_password: 1, created_at: when(-1) });
      if (!priorParentLinks.length) insert("parent_student_links", { id: id("parent-link"), parent_id: parent!.id, student_id: camel!.id, created_at: when(-21) });
      for (const [i, learner] of learners.entries()) {
        let enrollment = existingRoster.find(row => row.student_id === learner.id);
        if (!enrollment) {
          const rosterId = id(`roster-${i}`);
          insert("class_students", { id: rosterId, class_id: classroom.id, display_name: learner.display_name, token_hash: hashSessionToken(randomBytes(32).toString("hex")), created_at: when(-21) });
          enrollment = { id: id(`enrolment-${i}`), student_id: learner.id, class_id: classroom.id, class_student_id: rosterId, active: 1, created_at: when(-21) };
          insert("student_class_enrollments", enrollment);
        }
        for (const [session, offset] of [-14, -7, -2].entries()) insert("class_attendance", { id: id(`attendance-${i}-${session}`), class_id: classroom.id, student_id: learner.id, session_date: when(offset).slice(0,10), present: (i === 2 && session === 1) || (i === 4 && session === 2) ? 0 : 1, recorded_by: teacher!.id, recorded_at: when(offset, 3) });
        for (const [j, unit] of prepared.entries()) {
          if (i === 0) insert("class_activities", { id: id(`activity-${j}`), class_id: classroom.id, title: unit.title, instructions: `Demo heritage journey — read “${unit.topicData.title.en}” first, discuss one discovery, then complete the quiz. ${j === 3 ? "This final activity is ready for the live demonstration." : "Completed class practice; use the result to choose what to revise."}`, topic_id: unit.topic, questions_json: JSON.stringify(unit.questions), status: unit.closed ? "closed" : "open", created_at: when(unit.day, 1), updated_at: when(unit.day, 4) });
          // Leave the showcase open for everyone. Two learners have unfinished revision work.
          if (j === 3 || (i === 2 && j === 2) || (i === 4 && j === 1)) continue;
          const answers = unit.questions.map(q => q.answer);
          const mistakes = i === 0 ? (j === 0 ? 1 : 0) : (i + j) % 3;
          for (let k = 0; k < Math.min(mistakes, answers.length); k++) answers[k] = (answers[k] + 1) % unit.questions[k].options.length;
          const grade = gradeAnswers(unit.questions, answers);
          insert("activity_submissions", { id: id(`submission-${i}-${j}`), activity_id: id(`activity-${j}`), student_id: enrollment.class_student_id, answers_json: JSON.stringify(grade.picked), score: grade.score, total: grade.total, submitted_at: when(unit.day, 3) });
          // Keep any pre-existing read progress for Camel.
          if (!get("SELECT student_id FROM student_topic_progress WHERE student_id=? AND topic_id=?", String(learner.id), unit.topic)) insert("student_topic_progress", { student_id: learner.id, topic_id: unit.topic, completed_at: when(unit.day, 2) });
        }
      }
      for (const [key, audience, offset, body] of [
        ["welcome", "all", -15, "Demo heritage journey: Our Bangladesh. Tim Marco's class is exploring national symbols, rivers, New Year celebrations and traditional crafts. Read each topic before its class activity."],
        ["revision", "students", -1, "Learners: revisit your symbols result and practise any missed question. Our crafts showcase activity is open; choose one craft you would like to explain to the class."],
        ["family", "parents", -1, "Families: ask your child to share one fact about Bangladesh's rivers and one Pohela Boishakh tradition. The dashboard shows completed activities, marks and attendance. The crafts showcase is the next task."],
      ]) insert("class_announcements", { id: id(`notice-${key}`), class_id: classroom.id, body, audience, author_id: teacher!.id, created_at: when(Number(offset), 4) });
      insert("class_sources", { id: id("source"), class_id: classroom.id, title_en: "National Curriculum and Textbook Board — source catalogue", title_bn: "জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড", url: "https://nctb.gov.bd/", note: "Official source catalogue for our Bangladesh heritage unit. Use each in-app topic's references to locate its supporting textbook.", created_by: teacher!.id, created_at: when(-15) });
      insert("user_audit_events", { id: id("audit"), actor_id: admin!.id, target_id: classroom.id, target_type: "class", action: "operator-demo-seed", details_json: JSON.stringify({ runId: DEMO_ID, synthetic: true, summary }), created_at: new Date().toISOString() });
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Foreign key validation failed; rolling back.");
      insert("demo_seed_runs", { id: DEMO_ID, applied_at: new Date().toISOString(), summary_json: JSON.stringify(summary) });
    }).immediate();
    return { status: "applied", runId: DEMO_ID, summary, ...(options.mode === "live" ? { backupPath } : {}) };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !["--local", "--live", "--apply"].includes(arg)) || args.has("--local") === args.has("--live")) throw new Error("Usage: DATABASE_PATH=... node --import tsx scripts/seed-connected-demo.ts --local|--live [--apply]");
  const file = process.env.DATABASE_PATH;
  if (!file) throw new Error("DATABASE_PATH must be explicit.");
  console.log(JSON.stringify(await seedConnectedDemo(file, { mode: args.has("--local") ? "local" : "live", apply: args.has("--apply"), localPassword: process.env.DEMO_LOCAL_PASSWORD }), null, 2));
}
