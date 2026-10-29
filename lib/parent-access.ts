import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, students, parentStudentLinks, classes, classStudents, studentClassEnrollments, classActivities, activitySubmissions, userAuditEvents } from "../db/schema";
import { canManageUsers } from "./roles";
import { attendanceKey, studentAttendance } from "./class-attendance";
import { listAnnouncements } from "./class-announcements";
import { UserManagementError } from "./user-management";

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function requireAdministrator(tx: Transaction, actorId: string) {
  const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canManageUsers(actor)) throw new UserManagementError("Administrator access required.", 403);
}

export async function listParents(actorId: string, studentId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    if (!tx.select({ id: students.id }).from(students).where(eq(students.id, studentId)).get()) throw new UserManagementError("Student not found.", 404);
    return tx.select({ id: parentStudentLinks.id, parentId: adults.id, parentName: adults.displayName, parentEmail: adults.email, role: adults.role, status: adults.status })
      .from(parentStudentLinks).innerJoin(adults, eq(parentStudentLinks.parentId, adults.id))
      .where(eq(parentStudentLinks.studentId, studentId)).orderBy(adults.displayName).all();
  });
}

export async function linkParent(actorId: string, studentId: string, parentEmail: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    const parent = tx.select({ id: adults.id }).from(adults)
      .where(and(eq(adults.email, parentEmail.trim().toLowerCase()), eq(adults.role, "parent"), eq(adults.status, "active"), eq(adults.approvalStatus, "approved"))).get();
    if (!parent) throw new UserManagementError("No active parent account matches that email.", 404);
    const student = tx.select({ approvalStatus: students.approvalStatus }).from(students).where(eq(students.id, studentId)).get();
    if (!student) throw new UserManagementError("Student not found.", 404);
    // A self-registered child no administrator has approved is not shown to any family.
    if (student.approvalStatus !== "approved") throw new UserManagementError("Approve this student account before linking a parent.", 409);
    const link = tx.insert(parentStudentLinks).values({ id: crypto.randomUUID(), parentId: parent.id, studentId })
      .onConflictDoNothing({ target: [parentStudentLinks.parentId, parentStudentLinks.studentId] }).returning({ id: parentStudentLinks.id }).get();
    if (link) tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: studentId, targetType: "student", action: "parent-linked", detailsJson: JSON.stringify({ parentId: parent.id }) }).run();
    return { linked: true };
  });
}

export async function unlinkParent(actorId: string, studentId: string, parentId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    const removed = tx.delete(parentStudentLinks).where(and(eq(parentStudentLinks.studentId, studentId), eq(parentStudentLinks.parentId, parentId))).returning({ id: parentStudentLinks.id }).get();
    if (!removed) throw new UserManagementError("Parent link not found.", 404);
    tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: studentId, targetType: "student", action: "parent-unlinked", detailsJson: JSON.stringify({ parentId }) }).run();
    return { unlinked: true };
  });
}

export async function getParentOverview(parentId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    const parent = tx.select({ id: adults.id }).from(adults).where(and(eq(adults.id, parentId), eq(adults.role, "parent"), eq(adults.status, "active"))).get();
    if (!parent) throw new UserManagementError("Parent access required.", 403);
    const children = tx.select({ id: students.id, username: students.username, displayName: students.displayName, status: students.status })
      .from(parentStudentLinks).innerJoin(students, eq(parentStudentLinks.studentId, students.id))
      .where(eq(parentStudentLinks.parentId, parent.id)).orderBy(students.displayName, students.id).all();
    const ids = children.map((child) => child.id);
    const enrollments = ids.length ? tx.select({ studentId: studentClassEnrollments.studentId, classStudentId: classStudents.id, classId: classes.id, name: classes.name, teacherName: adults.displayName })
      .from(studentClassEnrollments)
      .innerJoin(classes, eq(studentClassEnrollments.classId, classes.id))
      .innerJoin(classStudents, and(eq(studentClassEnrollments.classStudentId, classStudents.id), eq(classStudents.classId, classes.id)))
      .innerJoin(adults, eq(classes.teacherId, adults.id))
      .where(and(inArray(studentClassEnrollments.studentId, ids), eq(studentClassEnrollments.active, true))).all() : [];
    const classIds = [...new Set(enrollments.map((enrollment) => enrollment.classId))];
    const rosterIds = enrollments.map((enrollment) => enrollment.classStudentId);
    const activities = classIds.length ? tx.select({ id: classActivities.id, classId: classActivities.classId, title: classActivities.title, instructions: classActivities.instructions, status: classActivities.status, createdAt: classActivities.createdAt })
      .from(classActivities).where(inArray(classActivities.classId, classIds)).orderBy(desc(classActivities.createdAt)).all() : [];
    const submissions = rosterIds.length ? tx.select({ activityId: activitySubmissions.activityId, studentId: activitySubmissions.studentId, score: activitySubmissions.score, total: activitySubmissions.total, submittedAt: activitySubmissions.submittedAt })
      .from(activitySubmissions).where(inArray(activitySubmissions.studentId, rosterIds)).all() : [];
    const attendance = studentAttendance(tx, ids);
    // Posts for everyone in the class and for parents, from the classes the linked children are in now,
    // newest first. Brothers and sisters in the same class share one entry naming them both.
    const announcements = listAnnouncements(tx, classIds, "parent").map((notice) => {
      const inClass = enrollments.filter((enrollment) => enrollment.classId === notice.classId);
      return { id: notice.id, body: notice.body, audience: notice.audience, authorName: notice.authorName, createdAt: notice.createdAt,
        className: inClass[0]?.name ?? "", children: children.filter((child) => inClass.some((enrollment) => enrollment.studentId === child.id)).map((child) => ({ id: child.id, displayName: child.displayName })) };
    });
    return { announcements, children: children.map((child) => {
      const childClasses = enrollments.filter((enrollment) => enrollment.studentId === child.id).map((enrollment) => ({
        id: enrollment.classId, name: enrollment.name, teacherName: enrollment.teacherName,
        // Sessions attended of the sessions the teacher recorded for this child in this class.
        attendance: attendance.get(attendanceKey(child.id, enrollment.classId)) ?? { attended: 0, recorded: 0 },
        activities: activities.filter((activity) => activity.classId === enrollment.classId).map((activity) => {
          const submission = submissions.find((entry) => entry.activityId === activity.id && entry.studentId === enrollment.classStudentId);
          return { id: activity.id, title: activity.title, instructions: activity.instructions, status: activity.status, createdAt: activity.createdAt,
            submission: submission ? { score: submission.score, total: submission.total, submittedAt: submission.submittedAt } : null };
        }),
      }));
      const work = childClasses.flatMap((item) => item.activities);
      const completed = work.filter((item) => item.submission);
      const score = completed.reduce((sum, item) => sum + (item.submission?.score ?? 0), 0);
      const total = completed.reduce((sum, item) => sum + (item.submission?.total ?? 0), 0);
      return { ...child, classes: childClasses, metrics: { enrolledClasses: childClasses.length, assignedActivities: work.length, completedActivities: completed.length, averagePercent: total > 0 ? Math.round(score / total * 100) : null,
        attendedSessions: childClasses.reduce((sum, item) => sum + item.attendance.attended, 0), recordedSessions: childClasses.reduce((sum, item) => sum + item.attendance.recorded, 0) } };
    }), updatedAt: new Date().toISOString() };
  });
}

export type ParentOverview = Awaited<ReturnType<typeof getParentOverview>>;
export type ParentLink = Awaited<ReturnType<typeof listParents>>[number];
