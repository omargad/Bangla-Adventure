import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { adults, adultSessions, recoveryCodes } from "../db/schema";
import {
  createSessionToken,
  generateRecoveryCode,
  hashPassword,
  hashSessionToken,
  normalizeRecoveryCode,
  verifyPassword,
} from "./password";
import { canManageUsers, canTeach, type AdultRole, type AccountStatus, type TeacherStatus } from "./roles";

export type Adult = {
  id: string;
  email: string;
  displayName: string;
  role: AdultRole;
  status: AccountStatus;
  teacherStatus: TeacherStatus;
};

export const publicAdultFields = {
  id: adults.id, email: adults.email, displayName: adults.displayName,
  role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus,
};
export const SESSION_COOKIE = "ba_adult_session";
const SESSION_DAYS = 30;
const SIGN_IN_PATH = "/grown-ups";
const dummyPasswordHash = hashPassword(createSessionToken());

export async function getSessionAdult(): Promise<Adult | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;

  try {
    const db = await getDb();
    const now = new Date().toISOString();
    const [row] = await db
      .select(publicAdultFields)
      .from(adultSessions)
      .innerJoin(adults, eq(adultSessions.adultId, adults.id))
      .where(and(eq(adultSessions.tokenHash, hashSessionToken(token)), gt(adultSessions.expiresAt, now), eq(adults.status, "active")))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function requireAdult(returnTo: string): Promise<Adult> {
  const adult = await getSessionAdult();
  if (!adult) {
    redirect(`${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return adult;
}

export async function requireTeacher(returnTo: string): Promise<Adult> {
  const adult = await requireAdult(returnTo);
  if (!canTeach(adult)) redirect("/teach");
  return adult;
}

export async function getStaffAccess(permission: "teach" | "admin" = "teach"): Promise<Adult | Response> {
  const adult = await getSessionAdult();
  if (!adult) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!(permission === "admin" ? canManageUsers(adult) : canTeach(adult))) {
    return Response.json({ error: permission === "admin" ? "Administrator access required." : "An approved teacher account is required." }, { status: 403 });
  }
  return adult;
}

export function signOutPath(returnTo: string): string {
  return `/api/auth/sign-out?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function registerAdult(
  email: string,
  displayName: string,
  password: string,
  requestTeaching = false,
): Promise<Adult | { error: string }> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const [adult] = await db
    .insert(adults)
    .values({
      id: crypto.randomUUID(),
      email: normalized,
      displayName: displayName.trim().slice(0, 60),
      passwordHash: hashPassword(password),
      role: "parent",
      teacherStatus: requestTeaching ? "pending" : "none",
      teacherRequestedAt: requestTeaching ? new Date().toISOString() : null,
    })
    .onConflictDoNothing({ target: adults.email })
    .returning(publicAdultFields);
  return adult ?? { error: "An account with this email already exists. Sign in instead." };
}

export async function verifyAdultCredentials(email: string, password: string): Promise<Adult | null> {
  if (!password || password.length > 200) return null;
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const [row] = await db.select().from(adults).where(eq(adults.email, normalized)).limit(1);
  const valid = verifyPassword(password, row?.passwordHash ?? dummyPasswordHash);
  if (!row || !valid || row.status !== "active") return null;
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role, status: row.status, teacherStatus: row.teacherStatus };
}

export async function createAdultSession(adultId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const active = db.select({ id: adults.id }).from(adults).where(and(eq(adults.id, adultId), eq(adults.status, "active"))).get();
  if (!active) throw new Error("Account unavailable.");
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(adultSessions).values({
    tokenHash: hashSessionToken(token),
    adultId,
    expiresAt: expiresAt.toISOString(),
  });
  // Opportunistic cleanup of expired sessions.
  await db.delete(adultSessions).where(lt(adultSessions.expiresAt, new Date().toISOString()));
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const db = await getDb();
  await db.delete(adultSessions).where(eq(adultSessions.tokenHash, hashSessionToken(token)));
}

export async function destroyAllSessions(adultId: string): Promise<void> {
  const db = await getDb();
  await db.delete(adultSessions).where(eq(adultSessions.adultId, adultId));
}

/** Delete every session except the one identified by keepToken (used after a password change). */
export async function destroyOtherSessions(adultId: string, keepToken: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(adultSessions)
    .where(
      and(eq(adultSessions.adultId, adultId), ne(adultSessions.tokenHash, hashSessionToken(keepToken))),
    );
}

export async function updateAdultPassword(adultId: string, newPassword: string): Promise<void> {
  const db = await getDb();
  await db.update(adults).set({ passwordHash: hashPassword(newPassword) }).where(eq(adults.id, adultId));
}

const RECOVERY_CODE_COUNT = 8;

/** Replace any existing recovery codes with a fresh set; the plaintext is returned exactly once. */
export async function issueRecoveryCodes(adultId: string): Promise<string[]> {
  const db = await getDb();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  db.transaction((tx) => {
    tx.delete(recoveryCodes).where(eq(recoveryCodes.adultId, adultId)).run();
    tx.insert(recoveryCodes).values(codes.map((code) => ({
      id: crypto.randomUUID(), adultId, codeHash: hashSessionToken(normalizeRecoveryCode(code)),
    }))).run();
  });
  return codes;
}

/** Verify an unused recovery code for this email and consume it. Returns the adult on success. */
export async function consumeRecoveryCode(email: string, code: string): Promise<Adult | null> {
  const db = await getDb();
  const [adult] = await db.select(publicAdultFields).from(adults)
    .where(and(eq(adults.email, email.trim().toLowerCase()), eq(adults.status, "active"))).limit(1);
  if (!adult) return null;
  const [consumed] = await db.update(recoveryCodes).set({ usedAt: new Date().toISOString() })
    .where(and(eq(recoveryCodes.adultId, adult.id), eq(recoveryCodes.codeHash, hashSessionToken(normalizeRecoveryCode(code))), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  return consumed ? adult : null;
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
