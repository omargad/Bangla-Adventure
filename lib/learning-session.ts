import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { adults, adultSessions, students, studentSessions } from "../db/schema";
import { hashSessionToken } from "./password";

export async function hasLearningSession(adultToken?: string, studentToken?: string): Promise<boolean> {
  const usable = (token?: string): token is string => Boolean(token && token.length <= 100);
  if (!usable(adultToken) && !usable(studentToken)) return false;
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    if (usable(adultToken)) {
      const adult = db.select({ id: adults.id }).from(adultSessions).innerJoin(adults, eq(adultSessions.adultId, adults.id))
        .where(and(eq(adultSessions.tokenHash, hashSessionToken(adultToken)), gt(adultSessions.expiresAt, now), eq(adults.status, "active"))).get();
      if (adult) return true;
    }
    if (usable(studentToken)) {
      const student = db.select({ id: students.id }).from(studentSessions).innerJoin(students, eq(studentSessions.studentId, students.id))
        .where(and(eq(studentSessions.tokenHash, hashSessionToken(studentToken)), gt(studentSessions.expiresAt, now), eq(students.status, "active"))).get();
      if (student) return true;
    }
    return false;
  } catch { return false; }
}
