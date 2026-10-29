import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classAttendance, classes, studentClassEnrollments } from "../db/schema";
import { attendanceSessions, summarizeAttendance, type AttendanceMark, type AttendanceSummary } from "./attendance";
import { managedClass, type Staff } from "./class-access";
import { currentMembers } from "./class-roster";
import type { Tx } from "./enrollments";
import { UserManagementError } from "./user-management";

type Reader = Pick<Tx, "select">;
const notFound = () => new UserManagementError("Class not found.", 404, "ক্লাসটি পাওয়া যায়নি।");

/** Marks of students now allocated to the class (removed students' marks stay stored but uncounted). */
const allocatedMark = and(eq(studentClassEnrollments.studentId, classAttendance.studentId), eq(studentClassEnrollments.classId, classAttendance.classId), eq(studentClassEnrollments.active, true));

/** Every allocated student's attended and recorded sessions in one class. */
export function classAttendanceSummaries(reader: Reader, classId: string): Map<string, AttendanceSummary> {
  return summarizeAttendance(reader.select({ studentId: classAttendance.studentId, present: classAttendance.present }).from(classAttendance)
    .innerJoin(studentClassEnrollments, allocatedMark).where(eq(classAttendance.classId, classId)).all());
}

/** Attendance per student per class (keyed by attendanceKey) for these students' allocated classes. */
export function studentAttendance(reader: Reader, studentIds: string[]): Map<string, AttendanceSummary> {
  if (!studentIds.length) return new Map();
  const rows = reader.select({ studentId: classAttendance.studentId, classId: classAttendance.classId, present: classAttendance.present }).from(classAttendance)
    .innerJoin(studentClassEnrollments, allocatedMark).where(inArray(classAttendance.studentId, studentIds)).all();
  return summarizeAttendance(rows.map((row) => ({ studentId: attendanceKey(row.studentId, row.classId), present: row.present })));
}
export const attendanceKey = (studentId: string, classId: string) => `${studentId}:${classId}`;

/** Present and recorded marks per class over its allocated students, for the administrator listing. */
export function classAttendanceTotals(reader: Reader): Map<string, AttendanceSummary> {
  const rows = reader.select({ classId: classAttendance.classId, recorded: count(), attended: sql<number>`sum(${classAttendance.present})` }).from(classAttendance)
    .innerJoin(studentClassEnrollments, allocatedMark).groupBy(classAttendance.classId).all();
  return new Map(rows.map((row) => [row.classId, { attended: Number(row.attended ?? 0), recorded: row.recorded }]));
}

/**
 * One session's attendance sheet for a class this actor manages: every student now allocated, A–Z,
 * ticked present unless saved absent for that date, with each student's running totals, who saved
 * the date last and the class's session history.
 */
export async function attendanceSheet(actor: Staff, classId: string, date: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) throw notFound();
    const members = currentMembers(tx, [classId]).flatMap((member) => member.studentId ? [{ ...member, studentId: member.studentId }] : []);
    const records = tx.select({ studentId: classAttendance.studentId, sessionDate: classAttendance.sessionDate, present: classAttendance.present, recordedAt: classAttendance.recordedAt, recordedBy: adults.displayName })
      .from(classAttendance).innerJoin(studentClassEnrollments, allocatedMark).leftJoin(adults, eq(adults.id, classAttendance.recordedBy))
      .where(eq(classAttendance.classId, classId)).all();
    const onDate = new Map(records.filter((record) => record.sessionDate === date).map((record) => [record.studentId, record]));
    const latest = [...onDate.values()].reduce<(typeof records)[number] | null>((last, record) => (!last || record.recordedAt > last.recordedAt ? record : last), null);
    const totals = summarizeAttendance(records);
    return {
      date,
      saved: latest ? { recordedAt: latest.recordedAt, recordedBy: latest.recordedBy } : null,
      students: members.map((member) => ({
        studentId: member.studentId, displayName: member.displayName, username: member.username,
        present: onDate.get(member.studentId)?.present ?? true, saved: onDate.has(member.studentId),
        attendance: totals.get(member.studentId) ?? { attended: 0, recorded: 0 },
      })),
      sessions: attendanceSessions(records),
    };
  });
}

export type AttendanceSheet = Awaited<ReturnType<typeof attendanceSheet>>;

/**
 * Save one session: a mark for exactly the students now allocated (the sheet the teacher saw), saved
 * again in place when the date already has marks. Records who saved it and when; a routine save is
 * not audited.
 */
export async function saveAttendance(actor: Staff, classId: string, date: string, marks: AttendanceMark[]) {
  const db = await getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) throw notFound();
    const allocated = new Set(currentMembers(tx, [classId]).flatMap((member) => member.studentId ? [member.studentId] : []));
    if (marks.length !== allocated.size || marks.some((mark) => !allocated.has(mark.studentId))) {
      throw new UserManagementError("The class list has changed since this page loaded. Reload the attendance and save again.", 409, "পাতাটি খোলার পর ক্লাসের তালিকা বদলেছে। উপস্থিতি আবার লোড করে সংরক্ষণ করুন।");
    }
    const recordedAt = new Date().toISOString();
    for (const mark of marks) {
      tx.insert(classAttendance).values({ id: crypto.randomUUID(), classId, studentId: mark.studentId, sessionDate: date, present: mark.present, recordedBy: actor.id, recordedAt })
        .onConflictDoUpdate({ target: [classAttendance.classId, classAttendance.studentId, classAttendance.sessionDate], set: { present: mark.present, recordedBy: actor.id, recordedAt } }).run();
    }
    return { date, saved: marks.length, present: marks.filter((mark) => mark.present).length };
  });
}
