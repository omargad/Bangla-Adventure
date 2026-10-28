import { and, eq, gt, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { studentSessions, students, userAuditEvents } from "../db/schema";
import { createSessionToken, hashPassword, hashPasswordAsync, hashSessionToken, verifyPassword } from "./password";

export type Student = {
  id: string;
  username: string;
  displayName: string;
  /** True while a teacher-issued temporary password is still in use. */
  mustChangePassword: boolean;
};

export const STUDENT_SESSION_COOKIE = "ba_student_session";
export const STUDENT_PASSWORD_PATH = "/student/password";
const STUDENT_SESSION_DAYS = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;
const studentFields = { id: students.id, username: students.username, displayName: students.displayName, mustChangePassword: students.mustChangePassword };

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
    .returning(studentFields);
  return student;
}

export async function verifyStudentCredentials(username: string, password: string): Promise<Student | null> {
  const db = await getDb();
  const normalized = normalizeStudentUsername(username);
  const [row] = await db.select().from(students).where(eq(students.username, normalized)).limit(1);
  if (!row || row.status !== "active" || password.length > 200 || !verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, username: row.username, displayName: row.displayName, mustChangePassword: row.mustChangePassword };
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
      .select(studentFields)
      .from(studentSessions)
      .innerJoin(students, eq(studentSessions.studentId, students.id))
      .where(and(eq(studentSessions.tokenHash, hashSessionToken(token)), gt(studentSessions.expiresAt, now), eq(students.status, "active")))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/** What every student learning or data API answers while the temporary password is still in use. */
export function passwordChangeRequired(): Response {
  return Response.json({ error: "Choose your own password before you continue.", mustChangePassword: true }, { status: 403 });
}

/**
 * The signed-in student for learning and data APIs, or the response to send instead:
 * 401 without a session, 403 while the temporary password has not been replaced.
 * Session, sign-out and password routes use getSessionStudent so they stay available.
 */
export async function getStudentAccess(): Promise<Student | Response> {
  const student = await getSessionStudent();
  if (!student) return Response.json({ error: "Student sign in required." }, { status: 401 });
  if (student.mustChangePassword) return passwordChangeRequired();
  return student;
}

/** The page-side counterpart of getStudentAccess: student pages send a temporary password to the change form. */
export function redirectIfPasswordChangeRequired(student: Student | null): void {
  if (student?.mustChangePassword) redirect(STUDENT_PASSWORD_PATH);
}

export async function getStudentSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(STUDENT_SESSION_COOKIE)?.value ?? null;
}

/** Replace the password, clear the temporary-password flag and end every session except keepToken's. */
export async function changeStudentPassword(student: Student, newPassword: string, keepToken: string): Promise<void> {
  const passwordHash = await hashPasswordAsync(newPassword);
  const db = await getDb();
  db.transaction((tx) => {
    tx.update(students).set({ passwordHash, mustChangePassword: false }).where(eq(students.id, student.id)).run();
    tx.delete(studentSessions).where(and(eq(studentSessions.studentId, student.id), ne(studentSessions.tokenHash, hashSessionToken(keepToken)))).run();
    tx.insert(userAuditEvents).values({
      id: crypto.randomUUID(), actorId: student.id, targetId: student.id, targetType: "student",
      action: "student-password-changed", detailsJson: JSON.stringify({ temporary: student.mustChangePassword }),
    }).run();
  });
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
