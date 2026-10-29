import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { adults, adultSessions, students, studentSessions } from "../db/schema";
import { hashSessionToken } from "./password";

export type LearningSession = {
  signedIn: boolean;
  /** The adult session belongs to someone who must still replace an administrator-issued password. */
  adultMustChangePassword: boolean;
};

/** What the proxy needs to know about the request's session cookies, checked against stored state. */
export async function learningSession(adultToken?: string, studentToken?: string): Promise<LearningSession> {
  const none = { signedIn: false, adultMustChangePassword: false };
  const usable = (token?: string): token is string => Boolean(token && token.length <= 100);
  if (!usable(adultToken) && !usable(studentToken)) return none;
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    if (usable(adultToken)) {
      const adult = db.select({ mustChangePassword: adults.mustChangePassword }).from(adultSessions).innerJoin(adults, eq(adultSessions.adultId, adults.id))
        .where(and(eq(adultSessions.tokenHash, hashSessionToken(adultToken)), gt(adultSessions.expiresAt, now), eq(adults.status, "active"), eq(adults.approvalStatus, "approved"))).get();
      if (adult) return { signedIn: true, adultMustChangePassword: adult.mustChangePassword };
    }
    if (usable(studentToken)) {
      const student = db.select({ id: students.id }).from(studentSessions).innerJoin(students, eq(studentSessions.studentId, students.id))
        .where(and(eq(studentSessions.tokenHash, hashSessionToken(studentToken)), gt(studentSessions.expiresAt, now), eq(students.status, "active"), eq(students.approvalStatus, "approved"))).get();
      if (student) return { signedIn: true, adultMustChangePassword: false };
    }
    return none;
  } catch { return none; }
}

export async function hasLearningSession(adultToken?: string, studentToken?: string): Promise<boolean> {
  return (await learningSession(adultToken, studentToken)).signedIn;
}
