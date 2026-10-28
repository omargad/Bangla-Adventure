import { and, count, desc, eq, sum } from "drizzle-orm";
import { getDb } from "../db";
import { activitySubmissions, adults, classActivities, classStudents, classes, studentClassEnrollments, userAuditEvents } from "../db/schema";
import { managedClass, type Staff } from "./class-access";
import { scorePercent } from "./classroom";

export type ClassResultsSummary = {
  id: string;
  name: string;
  createdAt: string;
  teacherName: string;
  teacherEmail: string;
  studentCount: number;
  activityCount: number;
  submissionCount: number;
  averagePercent: number | null;
};

/**
 * Delete one submission so the student can attempt the activity again. Returns
 * false when it is not a submission in a class this actor manages. Every reset,
 * by a teacher or an administrator, is audited against the student's account
 * (or, for a legacy class-code learner without one, the roster row).
 */
export async function resetSubmission(actor: Staff, classId: string, submissionId: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction((tx) => {
    const submission = tx.select({ id: activitySubmissions.id, rosterId: activitySubmissions.studentId })
      .from(activitySubmissions)
      .innerJoin(classActivities, eq(activitySubmissions.activityId, classActivities.id))
      .innerJoin(classes, eq(classActivities.classId, classes.id))
      .where(and(eq(activitySubmissions.id, submissionId), managedClass(actor, classId)))
      .get();
    if (!submission) return false;
    tx.delete(activitySubmissions).where(eq(activitySubmissions.id, submission.id)).run();
    const enrollment = tx.select({ studentId: studentClassEnrollments.studentId }).from(studentClassEnrollments)
      .where(eq(studentClassEnrollments.classStudentId, submission.rosterId)).get();
    tx.insert(userAuditEvents).values({
      id: crypto.randomUUID(), actorId: actor.id, targetId: enrollment?.studentId ?? submission.rosterId,
      targetType: enrollment ? "student" : "class-student", action: "submission-reset",
      detailsJson: JSON.stringify({ classId, submissionId: submission.id }),
    }).run();
    return true;
  });
}

/** Every class with its teacher and result totals, newest first, for the administrator results view. */
export async function listClassResults(): Promise<ClassResultsSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: classes.id, name: classes.name, createdAt: classes.createdAt, teacherName: adults.displayName, teacherEmail: adults.email })
    .from(classes).innerJoin(adults, eq(classes.teacherId, adults.id)).orderBy(desc(classes.createdAt));
  const rosters = await db.select({ classId: classStudents.classId, students: count() }).from(classStudents).groupBy(classStudents.classId);
  const activities = await db.select({ classId: classActivities.classId, activities: count() }).from(classActivities).groupBy(classActivities.classId);
  const results = await db
    .select({ classId: classActivities.classId, submissions: count(), score: sum(activitySubmissions.score), total: sum(activitySubmissions.total) })
    .from(activitySubmissions).innerJoin(classActivities, eq(activitySubmissions.activityId, classActivities.id))
    .groupBy(classActivities.classId);
  const studentCounts = new Map(rosters.map((row) => [row.classId, row.students]));
  const activityCounts = new Map(activities.map((row) => [row.classId, row.activities]));
  const totals = new Map(results.map((row) => [row.classId, row]));
  return rows.map((row) => {
    const result = totals.get(row.id);
    return {
      ...row,
      studentCount: studentCounts.get(row.id) ?? 0,
      activityCount: activityCounts.get(row.id) ?? 0,
      submissionCount: result?.submissions ?? 0,
      // Score-weighted, like the per-student average in the teacher workspace.
      averagePercent: result ? scorePercent(Number(result.score), Number(result.total)) : null,
    };
  });
}
