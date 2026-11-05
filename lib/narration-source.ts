import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { adults, classActivities, classes, classStudents, parentStudentLinks, studentClassEnrollments, students } from "@/db/schema";
import { getSignedInAdult } from "./auth";
import { getSessionStudent } from "./student-auth";
import { canManageUsers, canTeach } from "./roles";
import { findApprovedTopic } from "./curriculum-catalog";
import { activityNarrationText, detectNarrationLanguage, topicNarrationText } from "./narration-model";

export type NarrationActor = { kind: "adult" | "student"; id: string; key: string };
export type NarrationSourceRequest = { kind: "topic" | "activity"; id: string; slot: string; language: "bn" | "en" };

/** Only fixed, public messages belong in this error; database errors stay private. */
export class NarrationSourceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const unavailable = () => new NarrationSourceError(404, "This content is no longer available.");
const signInRequired = () => new NarrationSourceError(401, "Sign in to listen to this content.");
const passwordRequired = () => new NarrationSourceError(403, "Choose your own password before you continue.");

export async function getNarrationActor(): Promise<NarrationActor> {
  const adult = await getSignedInAdult();
  if (adult) {
    if (adult.mustChangePassword) throw passwordRequired();
    return { kind: "adult", id: adult.id, key: `adult:${adult.id}` };
  }
  const student = await getSessionStudent();
  if (!student) throw signInRequired();
  if (student.mustChangePassword) throw passwordRequired();
  return { kind: "student", id: student.id, key: `student:${student.id}` };
}

/**
 * Resolve only stored, currently accessible text. Called before every generated
 * audio/cache read, so withdrawing content or removing an enrollment revokes it.
 */
export async function resolveNarrationSource(actor: NarrationActor, source: NarrationSourceRequest): Promise<string> {
  const db = await getDb();
  const adult = actor.kind === "adult"
    ? db.select().from(adults).where(eq(adults.id, actor.id)).get()
    : null;
  const student = actor.kind === "student"
    ? db.select().from(students).where(eq(students.id, actor.id)).get()
    : null;
  const account = adult ?? student;
  if (!account || account.status !== "active" || account.approvalStatus !== "approved") throw signInRequired();
  if (account.mustChangePassword) throw passwordRequired();

  if (source.kind === "topic") {
    // Staff use the same published content as learners here, never a draft.
    const topic = await findApprovedTopic(source.id);
    if (!topic) throw unavailable();
    const text = topicNarrationText(topic, source.slot, source.language);
    if (!text) throw new NarrationSourceError(400, "Choose a valid part of this topic.");
    return text;
  }

  const found = db.select({ activity: classActivities, teacherId: classes.teacherId })
    .from(classActivities).innerJoin(classes, eq(classActivities.classId, classes.id))
    .where(eq(classActivities.id, source.id)).get();
  if (!found) throw unavailable();
  const { activity, teacherId } = found;
  const staffAccess = Boolean(adult && canTeach(adult) && (canManageUsers(adult) || teacherId === adult.id));
  if (!staffAccess) {
    if (activity.status !== "open") throw unavailable();
    if (student) {
      const enrollment = db.select({ id: studentClassEnrollments.id }).from(studentClassEnrollments)
        .innerJoin(classStudents, and(eq(studentClassEnrollments.classStudentId, classStudents.id), eq(classStudents.classId, studentClassEnrollments.classId)))
        .where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.classId, activity.classId), eq(studentClassEnrollments.active, true))).get();
      if (!enrollment) throw unavailable();
    } else if (adult?.role === "parent") {
      const linked = db.select({ id: studentClassEnrollments.id }).from(parentStudentLinks)
        .innerJoin(students, eq(parentStudentLinks.studentId, students.id))
        .innerJoin(studentClassEnrollments, eq(studentClassEnrollments.studentId, students.id))
        .innerJoin(classStudents, and(eq(studentClassEnrollments.classStudentId, classStudents.id), eq(classStudents.classId, studentClassEnrollments.classId)))
        .where(and(eq(parentStudentLinks.parentId, adult.id), eq(students.status, "active"), eq(students.approvalStatus, "approved"), eq(studentClassEnrollments.classId, activity.classId), eq(studentClassEnrollments.active, true))).get();
      if (!linked) throw unavailable();
    } else {
      throw unavailable();
    }
  }

  const text = activityNarrationText(activity, source.slot);
  if (!text) throw new NarrationSourceError(400, "Choose a valid part of this activity.");
  if (detectNarrationLanguage(text) !== source.language) throw new NarrationSourceError(400, "Choose the language of this activity text.");
  return text;
}
