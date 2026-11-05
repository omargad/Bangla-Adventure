/** One-time, additive operator repair for the existing browser-created demo. Never run automatically. */
import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gradeAnswers, validateQuizQuestions, type QuizQuestion } from "../lib/classroom";
import { hashPassword } from "../lib/password";

export const DEMO_RECONCILE_ID = "browser-demo-completion-2026-11-v1";
export const DEMO_CLASS_ID = "9c8d1df5-ccf4-4535-9bd0-480b09538b40";
const fixtureId = (key: string) => `${DEMO_RECONCILE_ID}:${key}`;
type Row = Record<string, string | number | null>;
type Unit = { title: string; topic: string; questions: QuizQuestion[] };
export const DEMO_UNITS: Unit[] = [
  { title: "1. Our Bangladesh: symbols and identity", topic: "national-symbols", questions: [
    { prompt: "Which colours appear on the flag of Bangladesh?", options: ["Green and red", "Blue and white"], answer: 0 },
    { prompt: "What is the national flower of Bangladesh?", options: ["Water lily (shapla)", "Rose"], answer: 0 },
    { prompt: "What is the national language of Bangladesh?", options: ["Bangla", "Spanish"], answer: 0 },
  ] },
  { title: "2. River journeys: life beside the water", topic: "rivers-everyday-life", questions: [
    { prompt: "Which is a major river of Bangladesh?", options: ["Padma", "Amazon"], answer: 0 },
    { prompt: "How can boats help riverside communities?", options: ["They carry people and goods", "They make rivers disappear"], answer: 0 },
    { prompt: "How does river water help farmers?", options: ["It can water their crops", "It turns crops into stones"], answer: 0 },
  ] },
  { title: "3. A new year together: Pohela Boishakh", topic: "pohela-boishakh", questions: [
    { prompt: "What does Pohela Boishakh celebrate?", options: ["The Bengali New Year", "The last day of every week"], answer: 0 },
    { prompt: "Which month begins the Bengali year?", options: ["Boishakh", "December"], answer: 0 },
    { prompt: "What does Shubho Noboborsho mean?", options: ["Happy New Year", "Good night"], answer: 0 },
  ] },
  { title: "4. Our heritage showcase: crafts of Bengal", topic: "crafts-of-bengal", questions: [
    { prompt: "What is a nakshi kantha?", options: ["An embroidered quilt", "A fishing boat"], answer: 0 },
    { prompt: "What is Jamdani best known for?", options: ["Fine woven textiles and saris", "Building bridges"], answer: 0 },
    { prompt: "Where can you see colourful rickshaw art?", options: ["On decorated rickshaws", "Only inside computers"], answer: 0 },
  ] },
];
export const DEMO_ROSTER = [
  { username: "demo.maya", name: "Maya Rahman", scores: [3, 2, 3] },
  { username: "demo.arif", name: "Arif Hasan", scores: [2, 2, null] },
  { username: "demo.nadia", name: "Nadia Islam", scores: [3, 3, 2] },
  { username: "demo.rafi", name: "Rafi Ahmed", scores: [2, null, 2] },
  { username: "demo.zara", name: "Zara Chowdhury", scores: [3, 2, 2] },
];
const applicants = [
  { table: "adults", key: "email", login: "demo.laila.rahman@example.com", name: "Laila Rahman (Demo)", teacher: true, suffix: "laila" },
  { table: "adults", key: "email", login: "demo.nusrat.khan@example.com", name: "Nusrat Khan (Demo)", teacher: false, suffix: "nusrat" },
  { table: "students", key: "username", login: "demo.samira", name: "Samira Khan (Demo)", teacher: false, suffix: "samira" },
] as const;

function get(db: Database.Database, sql: string, ...args: (string | number)[]) {
  return db.prepare(sql).get(...args) as Row | undefined;
}
function insert(db: Database.Database, table: string, value: Row) {
  const keys = Object.keys(value);
  db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(value));
}
function previousRun(db: Database.Database) {
  return get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_reconcile_runs'")
    ? get(db, "SELECT * FROM demo_reconcile_runs WHERE id=?", DEMO_RECONCILE_ID) : undefined;
}

function plan(db: Database.Database) {
  const account = (table: "adults" | "students", key: string, value: string, name: string, role?: string) => {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE lower(${key})=?`).all(value) as Row[];
    const row = rows[0];
    if (rows.length !== 1 || row.display_name !== name || row.status !== "active" || row.approval_status !== "approved" || (role && row.role !== role)) {
      throw new Error(`Expected active, approved demo identity ${value} is missing or changed; nothing written.`);
    }
    return row;
  };
  const admin = account("adults", "email", "admin@admin.com", "Admin", "admin");
  const teacher = account("adults", "email", "timmarco@gmail.com", "Tim Marco", "teacher");
  const parent = account("adults", "email", "franksamo@gmail.com", "Frank Samo", "parent");
  const camel = account("students", "username", "camel", "Camel");
  const classroom = get(db, "SELECT * FROM classes WHERE id=?", DEMO_CLASS_ID);
  if (teacher.teacher_status !== "approved" || classroom?.teacher_id !== teacher.id || classroom.name !== "Demo Class") throw new Error("The expected Demo Class or teacher has changed.");
  const parentLinks = db.prepare("SELECT * FROM parent_student_links WHERE parent_id=?").all(parent.id) as Row[];
  if (parentLinks.length !== 1 || parentLinks[0].student_id !== camel.id) throw new Error("Frank's family links do not match the expected demo.");
  const roster = [camel, ...DEMO_ROSTER.map(s => account("students", "username", s.username, s.name))];
  const enrollments = db.prepare("SELECT e.*, r.class_id AS roster_class_id, r.display_name AS roster_name FROM student_class_enrollments e JOIN class_students r ON r.id=e.class_student_id WHERE e.class_id=?").all(DEMO_CLASS_ID) as Row[];
  if (enrollments.length !== 6 || new Set(enrollments.map(e => e.student_id)).size !== 6 || enrollments.some(e => e.active !== 1 || e.roster_class_id !== DEMO_CLASS_ID || !roster.some(s => s.id === e.student_id && s.display_name === e.roster_name))) throw new Error("The demo roster has changed.");
  const activityRows = db.prepare("SELECT * FROM class_activities WHERE class_id=?").all(DEMO_CLASS_ID) as Row[];
  if (activityRows.length !== DEMO_UNITS.length) throw new Error("The demo activities have changed.");
  const activities = DEMO_UNITS.map(unit => {
    const matches = activityRows.filter(a => a.title === unit.title && a.topic_id === unit.topic);
    if (matches.length !== 1) throw new Error(`Missing or ambiguous demo activity: ${unit.title}`);
    const activity = matches[0];
    if (activity.status !== "open") throw new Error(`Demo activity is no longer open: ${unit.title}`);
    const valid = validateQuizQuestions(JSON.parse(String(activity.questions_json)));
    if ("error" in valid || JSON.stringify(valid.questions) !== JSON.stringify(unit.questions)) throw new Error(`Questions differ from the reviewed demo: ${unit.title}`);
    return { id: activity.id, questions: valid.questions };
  });
  // Never target Camel, and never replace a student's already-submitted answers.
  const submissions: Row[] = [];
  const readings: Row[] = [];
  for (const [i, learner] of DEMO_ROSTER.entries()) {
    const student = roster[i + 1];
    const enrollment = enrollments.find(e => e.student_id === student.id)!;
    for (const [unitIndex, score] of learner.scores.entries()) {
      if (score === null) continue;
      const activity = activities[unitIndex];
      const alreadySubmitted = get(db, "SELECT id FROM activity_submissions WHERE activity_id=? AND student_id=?", String(activity.id), String(enrollment.class_student_id));
      if (!alreadySubmitted) {
        const answers = activity.questions.map((q, n) => n < score ? q.answer : (q.answer + 1) % q.options.length);
        const grade = gradeAnswers(activity.questions, answers);
        submissions.push({ id: fixtureId(`${learner.username}-${unitIndex}`), activity_id: activity.id, student_id: enrollment.class_student_id, answers_json: JSON.stringify(grade.picked), score: grade.score, total: grade.total });
      }
      if (!get(db, "SELECT student_id FROM student_topic_progress WHERE student_id=? AND topic_id=?", String(student.id), DEMO_UNITS[unitIndex].topic)) readings.push({ student_id: student.id, topic_id: DEMO_UNITS[unitIndex].topic });
    }
  }
  const newApplicants = applicants.filter(applicant => {
    const matches = db.prepare(`SELECT * FROM ${applicant.table} WHERE lower(${applicant.key})=?`).all(applicant.login) as Row[];
    if (!matches.length) return true;
    const existing = matches[0];
    const expectedRole = applicant.teacher ? ["parent", "teacher"] : ["parent"];
    if (matches.length !== 1 || existing.display_name !== applicant.name || (applicant.table === "adults" && (!expectedRole.includes(String(existing.role)) || (applicant.teacher && !["pending", "approved", "rejected"].includes(String(existing.teacher_status))) || (!applicant.teacher && existing.teacher_status !== "none")))) throw new Error(`Demo applicant identity collision: ${applicant.login}`);
    // Existing signup, approval, decline, password and session state are authoritative.
    return false;
  });
  for (const row of submissions) if (get(db, "SELECT id FROM activity_submissions WHERE id=?", String(row.id))) throw new Error("An unmarked fixture submission ID is occupied.");
  for (const applicant of newApplicants) if (get(db, `SELECT id FROM ${applicant.table} WHERE id=?`, fixtureId(applicant.suffix))) throw new Error("An unmarked applicant ID is occupied.");
  if (get(db, "SELECT id FROM user_audit_events WHERE id=?", fixtureId("audit"))) throw new Error("An unmarked audit ID is occupied.");
  return { admin, submissions, readings, newApplicants };
}

/** Dry-run is read-only, including schema. Apply never changes an existing row. */
export async function reconcileDemo(file: string, options: { apply?: boolean } = {}) {
  if (!file || file === ":memory:" || !path.isAbsolute(file) || !existsSync(file)) throw new Error("Use the absolute path to an existing database; a new database is never created.");
  const db = new Database(file, { readonly: !options.apply, fileMustExist: true });
  db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 10000");
  try {
    const previous = previousRun(db);
    if (previous) return { status: "already-applied", runId: DEMO_RECONCILE_ID, summary: JSON.parse(String(previous.summary_json)) };
    const planned = plan(db);
    const summaryOf = (p: ReturnType<typeof plan>) => ({ classId: DEMO_CLASS_ID, submissionsToAdd: p.submissions.length, readingsToAdd: p.readings.length, applicantsToAdd: p.newApplicants.map(a => ({ type: a.teacher ? "teacher" : a.table === "adults" ? "parent" : "student", login: a.login })), existingRecords: "preserved", camel: "unchanged", showcase: "unchanged" });
    if (!options.apply) return { status: "dry-run", runId: DEMO_RECONCILE_ID, summary: summaryOf(planned) };
    const backupPath = `${file}.before-${DEMO_RECONCILE_ID}-${randomUUID()}.sqlite`;
    await db.backup(backupPath); chmodSync(backupPath, 0o600);
    const timestamp = new Date().toISOString();
    // These synthetic pending applicants have no usable disclosed password. An
    // administrator may issue a temporary one through the normal recovery flow.
    const passwordHash = hashPassword(randomBytes(48).toString("base64url"));
    const summary = db.transaction(() => {
      if (previousRun(db)) throw new Error("Another operator applied the demo repair; rerun to see its status.");
      const current = plan(db); // Revalidate under the SQLite write lock.
      for (const row of current.submissions) insert(db, "activity_submissions", { ...row, submitted_at: timestamp });
      for (const row of current.readings) insert(db, "student_topic_progress", { ...row, completed_at: timestamp });
      for (const applicant of current.newApplicants) {
        const row: Row = { id: fixtureId(applicant.suffix), [applicant.key]: applicant.login, display_name: applicant.name, password_hash: passwordHash, status: "active", approval_status: "pending", must_change_password: 1, created_at: timestamp };
        if (applicant.table === "adults") Object.assign(row, { role: "parent", teacher_status: applicant.teacher ? "pending" : "none", teacher_requested_at: applicant.teacher ? timestamp : null });
        insert(db, applicant.table, row);
      }
      const summary = summaryOf(current);
      insert(db, "user_audit_events", { id: fixtureId("audit"), actor_id: current.admin.id, target_id: DEMO_CLASS_ID, target_type: "class", action: "operator-demo-completion", details_json: JSON.stringify({ runId: DEMO_RECONCILE_ID, synthetic: true, summary }), created_at: timestamp });
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Foreign key check failed; repair rolled back.");
      db.exec("CREATE TABLE IF NOT EXISTS demo_reconcile_runs (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, summary_json TEXT NOT NULL)");
      insert(db, "demo_reconcile_runs", { id: DEMO_RECONCILE_ID, applied_at: timestamp, summary_json: JSON.stringify(summary) });
      return summary;
    }).immediate();
    return { status: "applied", runId: DEMO_RECONCILE_ID, summary, backupPath };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply") || args.length > 1) throw new Error("Usage: DATABASE_PATH=/absolute/existing.db node --import tsx scripts/reconcile-demo.ts [--apply]");
  console.log(JSON.stringify(await reconcileDemo(process.env.DATABASE_PATH ?? "", { apply: args.includes("--apply") }), null, 2));
}
