import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { activitySubmissions, adults, classActivities, classStudents, classes, studentClassEnrollments } from "../db/schema";
import { gradeAnswers, type QuizQuestion } from "./classroom";

/** A route's answer: the HTTP status and the JSON body, with every message in English and Bangla. */
export type WorkResponse = { status: number; body: Record<string, unknown> };

const refuse = (status: number, error: string, errorBn: string, extra: Record<string, unknown> = {}): WorkResponse => ({ status, body: { error, errorBn, ...extra } });

/**
 * The roster row an allocation points at belongs to the allocated class. Results and submissions
 * are kept against the roster row, so a row from another class must never stand in for it.
 */
export const rosterInEnrolledClass = and(
  eq(classStudents.id, studentClassEnrollments.classStudentId),
  eq(classStudents.classId, studentClassEnrollments.classId),
)!;

export function parseQuestions(json: string): QuizQuestion[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as QuizQuestion[]) : [];
  } catch {
    return [];
  }
}

/**
 * A student hands in an open class activity. The answers are marked here and the first
 * submission is final: a second one is refused until the teacher resets it (see
 * resetSubmission in lib/grades.ts), so the correct answers returned with the result
 * cannot be used to raise the saved score.
 */
export async function submitActivityWork(studentId: string, activityId: unknown, answers: unknown): Promise<WorkResponse> {
  if (typeof activityId !== "string" || !activityId) return refuse(400, "Choose an activity.", "একটি কার্যক্রম বেছে নাও।");
  const db = await getDb();
  return db.transaction((tx) => {
    const activity = tx.select().from(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.approvalStatus, "approved"))).get();
    if (!activity) return refuse(404, "Activity not found.", "কার্যক্রমটি পাওয়া যায়নি।");
    if (activity.status !== "open") return refuse(409, "This activity is closed.", "এই কার্যক্রমটি বন্ধ।");

    const enrollment = tx
      .select({ classStudentId: studentClassEnrollments.classStudentId })
      .from(studentClassEnrollments)
      .innerJoin(classStudents, rosterInEnrolledClass)
      .where(and(eq(studentClassEnrollments.studentId, studentId), eq(studentClassEnrollments.classId, activity.classId), eq(studentClassEnrollments.active, true)))
      .get();
    if (!enrollment) return refuse(403, "Your teacher must allocate you to this class before you can submit.", "জমা দেওয়ার আগে শিক্ষককে তোমাকে এই ক্লাসে যোগ করতে হবে।");

    const earlier = tx.select({ score: activitySubmissions.score, total: activitySubmissions.total, submittedAt: activitySubmissions.submittedAt })
      .from(activitySubmissions)
      .where(and(eq(activitySubmissions.activityId, activityId), eq(activitySubmissions.studentId, enrollment.classStudentId)))
      .get();
    if (earlier) {
      return refuse(409,
        "You have already handed in this activity, so your first answers are kept. Ask your teacher if you need another try.",
        "তুমি এই কার্যক্রমটি আগেই জমা দিয়েছ, তাই প্রথমবারের উত্তরই রাখা হয়েছে। আবার চেষ্টা করতে চাইলে শিক্ষককে বলো।",
        { alreadySubmitted: true, submission: earlier });
    }

    const questions = parseQuestions(activity.questionsJson);
    if (!questions.length || !Array.isArray(answers) || answers.length !== questions.length ||
      !answers.every((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < questions[index].options.length)) {
      return refuse(400, "Answer every question with one of the available options.", "প্রতিটি প্রশ্নের উত্তর দেওয়া বিকল্পগুলো থেকে বেছে নাও।");
    }
    const { score, total, picked } = gradeAnswers(questions, answers);
    const submittedAt = new Date().toISOString();
    tx.insert(activitySubmissions).values({
      id: crypto.randomUUID(), activityId, studentId: enrollment.classStudentId, answersJson: JSON.stringify(picked), score, total, submittedAt,
    }).run();

    // The submission is final now, so the answers can be shown with the result.
    return {
      status: 200,
      body: {
        score,
        total,
        submittedAt,
        review: questions.map((question, index) => ({ prompt: question.prompt, picked: picked[index], answer: question.answer, correct: picked[index] === question.answer })),
      },
    };
  });
}

/** The student's own results in the classes they are allocated to now, newest first. */
export async function studentResults(studentId: string) {
  const db = await getDb();
  const enrollments = await db
    .select({ classStudentId: studentClassEnrollments.classStudentId, classId: classes.id, className: classes.name, teacherName: adults.displayName })
    .from(studentClassEnrollments)
    .innerJoin(classes, eq(studentClassEnrollments.classId, classes.id))
    .innerJoin(adults, eq(classes.teacherId, adults.id))
    .innerJoin(classStudents, rosterInEnrolledClass)
    .where(and(eq(studentClassEnrollments.studentId, studentId), eq(studentClassEnrollments.active, true)));
  const classStudentIds = enrollments.map((item) => item.classStudentId);
  const submissions = classStudentIds.length
    ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.studentId, classStudentIds)).orderBy(desc(activitySubmissions.submittedAt))
    : [];
  const activityIds = submissions.map((submission) => submission.activityId);
  const activities = activityIds.length ? await db.select().from(classActivities).where(and(inArray(classActivities.id, activityIds), eq(classActivities.approvalStatus, "approved"))) : [];

  const results = submissions.flatMap((submission) => {
    const enrollment = enrollments.find((item) => item.classStudentId === submission.studentId);
    // Only an approved activity of the class the roster row belongs to counts.
    const activity = activities.find((item) => item.id === submission.activityId && item.classId === enrollment?.classId);
    if (!enrollment || !activity) return [];
    return [{
      id: submission.id,
      activityId: submission.activityId,
      activityTitle: activity.title,
      className: enrollment.className,
      teacherName: enrollment.teacherName,
      score: submission.score,
      total: submission.total,
      percent: submission.total ? Math.round((submission.score / submission.total) * 100) : 0,
      submittedAt: submission.submittedAt,
    }];
  });
  const totalQuestions = results.reduce((sum, item) => sum + item.total, 0);
  const totalScore = results.reduce((sum, item) => sum + item.score, 0);
  return {
    summary: {
      attempts: results.length,
      averagePercent: totalQuestions ? Math.round((totalScore / totalQuestions) * 100) : 0,
      bestPercent: results.reduce((best, item) => Math.max(best, item.percent), 0),
    },
    results,
  };
}
