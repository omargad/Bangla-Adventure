import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { adults, adultSessions, recoveryCodes, userAuditEvents } from "../db/schema";
import {
  createSessionToken,
  generateRecoveryCode,
  hashPassword,
  hashPasswordAsync,
  hashSessionToken,
  normalizeRecoveryCode,
  verifyPassword,
} from "./password";
import { canManageUsers, canTeach, type AdultRole, type AccountStatus, type ApprovalStatus, type TeacherStatus } from "./roles";
import { PASSWORD_CHANGE_ERROR, passwordChangeDestination } from "./learning-policy";

export type Adult = {
  id: string;
  email: string;
  displayName: string;
  role: AdultRole;
  status: AccountStatus;
  teacherStatus: TeacherStatus;
  approvalStatus: ApprovalStatus;
  /** True while an administrator-issued password is still in use. */
  mustChangePassword: boolean;
};

export const publicAdultFields = {
  id: adults.id, email: adults.email, displayName: adults.displayName,
  role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus,
  approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword,
};
export const SESSION_COOKIE = "ba_adult_session";
const SESSION_DAYS = 30;
const SIGN_IN_PATH = "/grown-ups";
const dummyPasswordHash = hashPassword(createSessionToken());
type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The signed-in, active and approved adult, including one who must still replace an
 * administrator-issued password. Only the password form and API, the session status and the
 * sign-in page use this directly; everything else goes through getSessionAdult or requireAdult.
 */
export async function getSignedInAdult(): Promise<Adult | null> {
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
      .where(and(eq(adultSessions.tokenHash, hashSessionToken(token)), gt(adultSessions.expiresAt, now), eq(adults.status, "active"), eq(adults.approvalStatus, "approved")))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * The signed-in adult for pages and APIs, or null. Also null while an administrator-issued password
 * is still in use: the proxy has already sent those requests to the password form (or answered 403),
 * and this keeps every route that reads the session closed even without it.
 */
export async function getSessionAdult(): Promise<Adult | null> {
  const adult = await getSignedInAdult();
  return adult?.mustChangePassword ? null : adult;
}

export async function requireAdult(returnTo: string): Promise<Adult> {
  const adult = await getSignedInAdult();
  if (!adult) {
    redirect(`${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (adult.mustChangePassword) redirect(passwordChangeDestination(returnTo));
  return adult;
}

export async function requireTeacher(returnTo: string): Promise<Adult> {
  const adult = await requireAdult(returnTo);
  if (!canTeach(adult)) redirect("/teach");
  return adult;
}

/** What every adult API answers while an administrator-issued password is still in use. */
export function adultPasswordChangeRequired(): Response {
  return Response.json({ error: PASSWORD_CHANGE_ERROR, mustChangePassword: true }, { status: 403 });
}

export async function getStaffAccess(permission: "teach" | "admin" = "teach"): Promise<Adult | Response> {
  const adult = await getSignedInAdult();
  if (!adult) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (adult.mustChangePassword) return adultPasswordChangeRequired();
  if (!(permission === "admin" ? canManageUsers(adult) : canTeach(adult))) {
    return Response.json({ error: permission === "admin" ? "Administrator access required." : "An approved teacher account is required." }, { status: 403 });
  }
  return adult;
}

export function signOutPath(returnTo: string): string {
  return `/api/auth/sign-out?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Self sign-up: the account waits for an administrator before it can sign in. */
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
      approvalStatus: "pending",
    })
    .onConflictDoNothing({ target: adults.email })
    .returning(publicAdultFields);
  return adult ?? { error: "An account with this email already exists. Sign in instead." };
}

/** The active account with this email and password, approved or not: callers decide what approval allows. */
export async function verifyAdultCredentials(email: string, password: string): Promise<Adult | null> {
  if (!password || password.length > 200) return null;
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const [row] = await db.select().from(adults).where(eq(adults.email, normalized)).limit(1);
  const valid = verifyPassword(password, row?.passwordHash ?? dummyPasswordHash);
  if (!row || !valid || row.status !== "active") return null;
  return {
    id: row.id, email: row.email, displayName: row.displayName, role: row.role, status: row.status,
    teacherStatus: row.teacherStatus, approvalStatus: row.approvalStatus, mustChangePassword: row.mustChangePassword,
  };
}

export async function createAdultSession(adultId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const active = db.select({ id: adults.id }).from(adults).where(and(eq(adults.id, adultId), eq(adults.status, "active"), eq(adults.approvalStatus, "approved"))).get();
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

const RECOVERY_CODE_COUNT = 8;

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
}

/** Replace the adult's recovery codes with these, inside the caller's transaction. */
export function replaceRecoveryCodes(tx: Transaction, adultId: string, codes: string[]): void {
  tx.delete(recoveryCodes).where(eq(recoveryCodes.adultId, adultId)).run();
  tx.insert(recoveryCodes).values(codes.map((code) => ({
    id: crypto.randomUUID(), adultId, codeHash: hashSessionToken(normalizeRecoveryCode(code)),
  }))).run();
}

/** Replace any existing recovery codes with a fresh set; the plaintext is returned exactly once. */
export async function issueRecoveryCodes(adultId: string): Promise<string[]> {
  const db = await getDb();
  const codes = newRecoveryCodes();
  db.transaction((tx) => replaceRecoveryCodes(tx, adultId, codes));
  return codes;
}

/**
 * Replace the password, clear the administrator-issued flag and end every session except keepToken's.
 * An administrator saw the recovery codes of an account they issued a password for, so the first
 * change of such a password also issues fresh codes; they are returned once, otherwise null.
 */
export async function changeAdultPassword(adult: Adult, newPassword: string, keepToken: string): Promise<string[] | null> {
  const passwordHash = await hashPasswordAsync(newPassword);
  const codes = adult.mustChangePassword ? newRecoveryCodes() : null;
  const db = await getDb();
  db.transaction((tx) => {
    tx.update(adults).set({ passwordHash, mustChangePassword: false }).where(eq(adults.id, adult.id)).run();
    tx.delete(adultSessions).where(and(eq(adultSessions.adultId, adult.id), ne(adultSessions.tokenHash, hashSessionToken(keepToken)))).run();
    if (codes) replaceRecoveryCodes(tx, adult.id, codes);
    tx.insert(userAuditEvents).values({
      id: crypto.randomUUID(), actorId: adult.id, targetId: adult.id, targetType: "adult",
      action: "password-changed", detailsJson: JSON.stringify({ temporary: adult.mustChangePassword }),
    }).run();
  });
  return codes;
}

/**
 * Set the password the owner chose with a recovery code and end every session, in one transaction.
 * That also ends an administrator-issued password; the administrator saw the codes of such an account,
 * so they are replaced and the new ones returned once (otherwise null), exactly as on a first change.
 */
export async function recoverAdultPassword(adult: Adult, newPassword: string): Promise<string[] | null> {
  const passwordHash = await hashPasswordAsync(newPassword);
  const codes = adult.mustChangePassword ? newRecoveryCodes() : null;
  const db = await getDb();
  db.transaction((tx) => {
    tx.update(adults).set({ passwordHash, mustChangePassword: false }).where(eq(adults.id, adult.id)).run();
    tx.delete(adultSessions).where(eq(adultSessions.adultId, adult.id)).run();
    if (codes) replaceRecoveryCodes(tx, adult.id, codes);
  });
  return codes;
}

/**
 * Verify an unused recovery code for this email and consume it. Returns the adult on success.
 * For an account still waiting for (or refused) approval the code is checked but kept, so the
 * caller can say why the reset cannot happen yet without spending the code.
 */
export async function consumeRecoveryCode(email: string, code: string): Promise<Adult | null> {
  const db = await getDb();
  const [adult] = await db.select(publicAdultFields).from(adults)
    .where(and(eq(adults.email, email.trim().toLowerCase()), eq(adults.status, "active"))).limit(1);
  if (!adult) return null;
  const matches = and(eq(recoveryCodes.adultId, adult.id), eq(recoveryCodes.codeHash, hashSessionToken(normalizeRecoveryCode(code))), isNull(recoveryCodes.usedAt));
  if (adult.approvalStatus !== "approved") {
    return db.select({ id: recoveryCodes.id }).from(recoveryCodes).where(matches).get() ? adult : null;
  }
  const [consumed] = await db.update(recoveryCodes).set({ usedAt: new Date().toISOString() })
    .where(matches)
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
