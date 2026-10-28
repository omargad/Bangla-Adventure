import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { adults, adultSessions, recoveryCodes, students, studentSessions, userAuditEvents } from "../db/schema";
import { canManageUsers, isRole, isStatus } from "./roles";
import { generateRecoveryCode, hashPassword, hashSessionToken, normalizeRecoveryCode } from "./password";

export class UserManagementError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const adultFields = { id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, createdAt: adults.createdAt };
const studentFields = { id: students.id, username: students.username, displayName: students.displayName, status: students.status, createdAt: students.createdAt };
type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function authorize(tx: Transaction, actorId: string) {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canManageUsers(actor)) throw new UserManagementError("Administrator access required.", 403);
}

function record(tx: Transaction, actorId: string, targetId: string, targetType: string, action: string, details: object = {}) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId, targetType, action, detailsJson: JSON.stringify(details) }).run();
}

export async function listUsers(params: URLSearchParams) {
  const db = await getDb();
  const kind = params.get("kind") ?? "adult";
  const filter = params.get("filter") ?? "all";
  const search = params.get("q")?.trim().slice(0, 120) ?? "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const pageSize = 25;
  if (!["adult", "student"].includes(kind) || !["all", "pending", "parent", "teacher", "admin", "suspended"].includes(filter)) throw new UserManagementError("Invalid user filter.");
  const conditions: SQL[] = [];
  let users;
  let total;
  if (kind === "student") {
    if (filter !== "all" && filter !== "suspended") throw new UserManagementError("Invalid student filter.");
    if (search) conditions.push(or(like(students.displayName, `%${search}%`), like(students.username, `%${search}%`))!);
    if (filter === "suspended") conditions.push(eq(students.status, "suspended"));
    users = db.select(studentFields).from(students).where(and(...conditions)).orderBy(desc(students.createdAt), students.id).limit(pageSize).offset((page - 1) * pageSize).all().map((user) => ({ ...user, role: "student", teacherStatus: "none", kind }));
    total = db.select({ value: count() }).from(students).where(and(...conditions)).get()!.value;
  } else {
    if (search) conditions.push(or(like(adults.displayName, `%${search}%`), like(adults.email, `%${search}%`))!);
    if (filter === "pending") conditions.push(eq(adults.teacherStatus, "pending"));
    else if (filter === "suspended") conditions.push(eq(adults.status, "suspended"));
    else if (isRole(filter)) conditions.push(eq(adults.role, filter));
    users = db.select(adultFields).from(adults).where(and(...conditions)).orderBy(desc(adults.createdAt), adults.id).limit(pageSize).offset((page - 1) * pageSize).all().map((user) => ({ ...user, kind }));
    total = db.select({ value: count() }).from(adults).where(and(...conditions)).get()!.value;
  }
  const stats = {
    adults: db.select({ value: count() }).from(adults).get()!.value,
    students: db.select({ value: count() }).from(students).get()!.value,
    teachers: db.select({ value: count() }).from(adults).where(and(eq(adults.role, "teacher"), eq(adults.status, "active"), eq(adults.teacherStatus, "approved"))).get()!.value,
    pending: db.select({ value: count() }).from(adults).where(eq(adults.teacherStatus, "pending")).get()!.value,
  };
  const audit = db.select().from(userAuditEvents).orderBy(desc(userAuditEvents.createdAt), desc(userAuditEvents.id)).limit(15).all();
  return { users, total, page, pageSize, stats, audit };
}

export async function updateUser(actorId: string, id: string, input: Record<string, unknown>) {
  if (input.kind !== "adult" && input.kind !== "student") throw new UserManagementError("Choose an account type.");
  if (input.displayName !== undefined && (typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.trim().length > 60)) throw new UserManagementError("Use a display name of 1–60 characters.");
  if (input.status !== undefined && !isStatus(input.status)) throw new UserManagementError("Invalid account status.");
  if (input.role !== undefined && !isRole(input.role)) throw new UserManagementError("Invalid account role.");
  const action = input.action ?? "update";
  if (!["update", "approve", "reject", "revoke-sessions"].includes(String(action))) throw new UserManagementError("Invalid management action.");
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId);
    if (input.kind === "student") {
      if (input.role !== undefined || action === "approve" || action === "reject") throw new UserManagementError("Student accounts cannot be promoted to staff.");
      const current = tx.select(studentFields).from(students).where(eq(students.id, id)).get();
      if (!current) throw new UserManagementError("User not found.", 404);
      const next = { displayName: typeof input.displayName === "string" ? input.displayName.trim() : current.displayName, status: isStatus(input.status) ? input.status : current.status };
      tx.update(students).set(next).where(eq(students.id, id)).run();
      if (next.status !== current.status || action === "revoke-sessions") tx.delete(studentSessions).where(eq(studentSessions.studentId, id)).run();
      record(tx, actorId, id, "student", String(action), { previousStatus: current.status, status: next.status });
      return { ...current, ...next };
    }
    const current = tx.select(adultFields).from(adults).where(eq(adults.id, id)).get();
    if (!current) throw new UserManagementError("User not found.", 404);
    const next = {
      displayName: typeof input.displayName === "string" ? input.displayName.trim() : current.displayName,
      status: isStatus(input.status) ? input.status : current.status,
      role: isRole(input.role) ? input.role : current.role,
      teacherStatus: current.teacherStatus,
    };
    if (action === "approve" || action === "reject") {
      if (current.teacherStatus !== "pending" || current.status !== "active" || current.role !== "parent") throw new UserManagementError("This request is no longer awaiting approval.", 409);
      next.role = action === "approve" ? "teacher" : "parent";
      next.teacherStatus = action === "approve" ? "approved" : "rejected";
    } else if (next.role !== current.role) next.teacherStatus = next.role === "teacher" ? "approved" : "none";
    if (id === actorId && (next.role !== current.role || next.status !== current.status)) throw new UserManagementError("You cannot change your own role or suspend your own account.", 409);
    if (current.role === "admin" && current.status === "active" && (next.role !== "admin" || next.status !== "active")) {
      const remaining = tx.select({ value: count() }).from(adults).where(and(eq(adults.role, "admin"), eq(adults.status, "active"))).get()!.value;
      if (remaining <= 1) throw new UserManagementError("At least one active administrator must remain.", 409);
    }
    tx.update(adults).set(next).where(eq(adults.id, id)).run();
    if (next.role !== current.role || next.status !== current.status || action === "revoke-sessions") tx.delete(adultSessions).where(eq(adultSessions.adultId, id)).run();
    record(tx, actorId, id, "adult", String(action), { previousRole: current.role, role: next.role, previousStatus: current.status, status: next.status, teacherStatus: next.teacherStatus });
    return { ...current, ...next };
  });
}

export async function createUser(actorId: string, input: Record<string, unknown>) {
  const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const kind = input.kind;
  if (!name || name.length > 60 || !["adult", "student"].includes(String(kind))) throw new UserManagementError("Choose an account type and a display name of 1–60 characters.");
  if (password.length < 10 || password.length > 200) throw new UserManagementError("Use a password of 10–200 characters.");
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  if (kind === "adult" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || !["parent", "teacher"].includes(String(input.role)))) throw new UserManagementError("Choose parent or teacher and a valid email address.");
  if (kind === "student" && !/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserManagementError("Choose a username of 3–40 letters, numbers, dots, dashes or underscores.");
  const passwordHash = hashPassword(password);
  const codes = kind === "adult" ? Array.from({ length: 8 }, () => generateRecoveryCode()) : [];
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId);
    const id = crypto.randomUUID();
    if (kind === "student") {
      const user = tx.insert(students).values({ id, username, displayName: name, passwordHash }).onConflictDoNothing({ target: students.username }).returning(studentFields).get();
      if (!user) throw new UserManagementError("That username is already taken.", 409);
      record(tx, actorId, id, "student", "created");
      return { user };
    }
    const role = input.role === "teacher" ? "teacher" : "parent";
    const user = tx.insert(adults).values({ id, email, displayName: name, passwordHash, role, teacherStatus: role === "teacher" ? "approved" : "none" })
      .onConflictDoNothing({ target: adults.email }).returning(adultFields).get();
    if (!user) throw new UserManagementError("That email is already registered.", 409);
    tx.insert(recoveryCodes).values(codes.map((code) => ({ id: crypto.randomUUID(), adultId: id, codeHash: hashSessionToken(normalizeRecoveryCode(code)) }))).run();
    record(tx, actorId, id, "adult", "created", { role });
    return { user, recoveryCodes: codes };
  });
}
