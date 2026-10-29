/**
 * Class attendance rules shared by the server and the browser, so this module stays free of
 * database and Node-only imports. A class session is the date a teacher saves attendance for.
 */

/** Sessions a student attended, of the sessions recorded for them. */
export type AttendanceSummary = { attended: number; recorded: number };
export type AttendanceMark = { studentId: string; present: boolean };

/** The most marks one save may carry (far more than one class holds). */
export const MAX_ATTENDANCE_MARKS = 500;
const SESSION_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A date as 'YYYY-MM-DD' in the local time where this runs: the teacher's own today in the browser. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * A class session date, or the reason it cannot be used. It must be a real 'YYYY-MM-DD' date from
 * 2000 on and no later than tomorrow in UTC, which leaves room for teachers ahead of the server's clock.
 */
export function checkSessionDate(value: unknown, now = new Date()): { date: string } | { error: string; errorBn: string } {
  const match = typeof value === "string" ? SESSION_DATE.exec(value) : null;
  const [year, month, day] = match ? match.slice(1).map(Number) : [0, 0, 0];
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (!match || year < 2000 || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { error: "Choose the date of the class (YYYY-MM-DD).", errorBn: "ক্লাসের তারিখ বেছে নিন (YYYY-MM-DD)।" };
  }
  if (time > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) {
    return { error: "Attendance cannot be taken for a future date.", errorBn: "ভবিষ্যতের তারিখের উপস্থিতি নেওয়া যায় না।" };
  }
  return { date: value as string };
}

/**
 * The marks of one attendance save: a non-empty list of { studentId, present } with each student
 * once. Returns null when the body is not that shape.
 */
export function parseAttendanceMarks(value: unknown): AttendanceMark[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ATTENDANCE_MARKS) return null;
  const seen = new Set<string>();
  const marks: AttendanceMark[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { studentId, present } = item as { studentId?: unknown; present?: unknown };
    if (typeof studentId !== "string" || !studentId || studentId.length > 80 || typeof present !== "boolean" || seen.has(studentId)) return null;
    seen.add(studentId);
    marks.push({ studentId, present });
  }
  return marks;
}

/** Sessions attended and recorded per student, from attendance records (one per student per session). */
export function summarizeAttendance(records: Array<{ studentId: string; present: boolean }>): Map<string, AttendanceSummary> {
  const summaries = new Map<string, AttendanceSummary>();
  for (const record of records) {
    const summary = summaries.get(record.studentId) ?? { attended: 0, recorded: 0 };
    summary.recorded += 1;
    if (record.present) summary.attended += 1;
    summaries.set(record.studentId, summary);
  }
  return summaries;
}

/** Every recorded session, newest first, with how many of the students marked that day were present. */
export function attendanceSessions(records: Array<{ sessionDate: string; present: boolean }>): Array<{ date: string; present: number; marked: number }> {
  const sessions = new Map<string, { date: string; present: number; marked: number }>();
  for (const record of records) {
    const session = sessions.get(record.sessionDate) ?? { date: record.sessionDate, present: 0, marked: 0 };
    session.marked += 1;
    if (record.present) session.present += 1;
    sessions.set(record.sessionDate, session);
  }
  return [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Attendance as a whole-number percentage, or null before any session is recorded. */
export function attendancePercent(summary: AttendanceSummary | null | undefined): number | null {
  return summary && summary.recorded > 0 ? Math.round((summary.attended / summary.recorded) * 100) : null;
}
