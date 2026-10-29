import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { classStudents, studentClassEnrollments, students } from "../db/schema";
import type { Tx } from "./enrollments";

/**
 * Who is in a class now: students whose allocation is active, and learners who joined with an old
 * class code (they have no account, so no allocation). Students whose allocation was removed are
 * left out of rosters, results, counts and exports; their roster row, work and attendance stay for
 * their own records and come back if they are added again.
 */
export const currentMember = or(isNull(studentClassEnrollments.id), eq(studentClassEnrollments.active, true))!;

export type ClassMember = { id: string; classId: string; studentId: string | null; username: string | null; displayName: string; createdAt: string };

/** Sort by name as people read it (case- and accent-insensitive), then by username. */
export function byName(a: { displayName: string; username?: string | null }, b: { displayName: string; username?: string | null }) {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base", numeric: true }) || (a.username ?? "").localeCompare(b.username ?? "");
}

/**
 * The current members of these classes, A–Z. `id` is the roster row that submissions point at;
 * `studentId` is the student account (null for a class-code learner). The name is the account's
 * current name, so renaming a student in Users renames them in every class.
 */
export function currentMembers(reader: Pick<Tx, "select">, classIds: string[]): ClassMember[] {
  if (!classIds.length) return [];
  return reader.select({
    id: classStudents.id, classId: classStudents.classId, studentId: studentClassEnrollments.studentId, username: students.username,
    displayName: sql<string>`coalesce(${students.displayName}, ${classStudents.displayName})`, createdAt: classStudents.createdAt,
  }).from(classStudents)
    .leftJoin(studentClassEnrollments, eq(studentClassEnrollments.classStudentId, classStudents.id))
    .leftJoin(students, eq(students.id, studentClassEnrollments.studentId))
    .where(and(inArray(classStudents.classId, classIds), currentMember))
    .all().sort(byName);
}
