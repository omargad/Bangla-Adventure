import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { studentSessions, students } from "../db/schema";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./password";

export type Student = {
  id: string;
  username: string;
  displayName: string;
};

export const STUDENT_SESSION_COOKIE = "ba_student_session";
const STUDENT_SESSION_DAYS = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;

export function normalizeStudentUsername(username: string): string {
  return username.trim().toLowerCase().slice(0, 40);
}

export function validateStudentUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export function studentCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  };
}

export async function registerStudent(
  username: string,
  displayName: string,
  password: string,
): Promise<Student | { error: string }> {
  const db = await getDb();
  if (username.trim().length > 40 || displayName.trim().length > 60) return { error: "Use a username of at most 40 characters and a student name of at most 60 characters." };
  const normalized = normalizeStudentUsername(username);
  if (!validateStudentUsername(normalized)) return { error: "Choose a username with 3–40 letters, numbers, dots, dashes or underscores." };
  const cleanName = displayName.trim().slice(0, 60);
  if (!cleanName) return { error: "Enter the student name." };
  if (password.length < 8 || password.length > 200) return { error: "Choose a password with at least 8 characters. A grown-up can help you choose one." };

  const [existing] = await db.select({ id: students.id }).from(students).where(eq(students.username, normalized)).limit(1);
  if (existing) return { error: "That username is already taken." };

  const [student] = await db
    .insert(students)
    .values({ id: crypto.randomUUID(), username: normalized, displayName: cleanName, passwordHash: hashPassword(password) })
    .returning({ id: students.id, username: students.username, displayName: students.displayName });
  return student;
}

export async function verifyStudentCredentials(username: string, password: string): Promise<Student | null> {
  const db = await getDb();
  const normalized = normalizeStudentUsername(username);
  const [row] = await db.select().from(students).where(eq(students.username, normalized)).limit(1);
  if (!row || row.status !== "active" || password.length > 200 || !verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, username: row.username, displayName: row.displayName };
}

export async function createStudentSession(studentId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + STUDENT_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(studentSessions).values({ tokenHash: hashSessionToken(token), studentId, expiresAt: expiresAt.toISOString() });
  return { token, expiresAt };
}

export async function getSessionStudent(): Promise<Student | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STUDENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const [row] = await db
      .select({ id: students.id, username: students.username, displayName: students.displayName })
      .from(studentSessions)
      .innerJoin(students, eq(studentSessions.studentId, students.id))
      .where(and(eq(studentSessions.tokenHash, hashSessionToken(token)), gt(studentSessions.expiresAt, now), eq(students.status, "active")))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function deleteCurrentStudentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STUDENT_SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  await db.delete(studentSessions).where(eq(studentSessions.tokenHash, hashSessionToken(token)));
}

export async function cleanupExpiredStudentSessions(): Promise<void> {
  const db = await getDb();
  await db.delete(studentSessions).where(lt(studentSessions.expiresAt, new Date().toISOString()));
}
