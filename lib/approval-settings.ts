import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, appSettings, userAuditEvents } from "../db/schema";
import type { Bilingual } from "../app/topics-content";
import { canPublishContent } from "./roles";

/**
 * Approval settings an administrator changes on the Topics page. Today there is one:
 * whether a teacher's new or edited topic waits for an administrator's approval. It is on
 * by default, and a setting without a stored row (an installation from before the setting,
 * or one where nobody has changed it) is on, so nothing is published unreviewed by an upgrade.
 * An administrator's own topics never wait (see lib/curriculum-catalog.ts).
 */
export const TEACHER_TOPIC_APPROVAL = "teacher-topics-need-approval";
export const TEACHER_TOPIC_APPROVAL_LABEL: Bilingual = {
  en: "Teachers' topics need an administrator's approval",
  bn: "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন প্রয়োজন",
};

export type ApprovalSettings = {
  /** A teacher's new or edited topic waits for an administrator before students see it. */
  teacherTopicsNeedApproval: boolean;
  /** Who last changed the setting and when; null while it has its default. */
  changedByName: string | null;
  changedAt: string | null;
};

export class SettingError extends Error {
  constructor(message: string, public messageBn: string, public status = 400) { super(message); }
}

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;

function storedRow(db: Reader) {
  return db.select().from(appSettings).where(eq(appSettings.key, TEACHER_TOPIC_APPROVAL)).get();
}

/** Whether teachers' topics wait for approval. Only a stored `false` turns it off: a missing or unreadable value keeps it on. */
export function teacherTopicsNeedApproval(db: Reader): boolean {
  const row = storedRow(db);
  if (!row) return true;
  try { return JSON.parse(row.valueJson) !== false; } catch { return true; }
}

function settingsFrom(db: Reader): ApprovalSettings {
  const row = storedRow(db);
  const name = row?.updatedBy ? db.select({ name: adults.displayName }).from(adults).where(eq(adults.id, row.updatedBy)).get()?.name ?? null : null;
  return { teacherTopicsNeedApproval: teacherTopicsNeedApproval(db), changedByName: name, changedAt: row?.updatedAt ?? null };
}

export async function getApprovalSettings(): Promise<ApprovalSettings> {
  return settingsFrom(await getDb());
}

/**
 * An administrator turns "Teachers' topics need an administrator's approval" on or off. The account is
 * checked again inside the transaction (an active, approved administrator without a temporary password),
 * and every change is audited as approval-setting-changed. Topics already waiting stay waiting either way:
 * turning approval off publishes only what teachers save from then on.
 */
export async function setTeacherTopicApproval(actorId: string, raw: unknown): Promise<ApprovalSettings & { changed: boolean }> {
  const value = raw && typeof raw === "object" ? (raw as { teacherTopicsNeedApproval?: unknown }).teacherTopicsNeedApproval : undefined;
  if (typeof value !== "boolean") throw new SettingError("Choose whether teachers' topics need an administrator's approval.", "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন লাগবে কি না, বেছে নিন।");
  const db = await getDb();
  return db.transaction((tx) => {
    const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword }).from(adults).where(eq(adults.id, actorId)).get();
    if (!actor || !canPublishContent(actor)) throw new SettingError("Only an administrator can change who needs approval.", "কার অনুমোদন লাগবে, তা শুধু প্রশাসক বদলাতে পারেন।", 403);
    const before = teacherTopicsNeedApproval(tx);
    if (before === value) return { ...settingsFrom(tx), changed: false };
    const updatedAt = new Date().toISOString();
    tx.insert(appSettings).values({ key: TEACHER_TOPIC_APPROVAL, valueJson: JSON.stringify(value), updatedBy: actorId, updatedAt })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(value), updatedBy: actorId, updatedAt } }).run();
    tx.insert(userAuditEvents).values({
      id: crypto.randomUUID(), actorId, targetId: TEACHER_TOPIC_APPROVAL, targetType: "setting", action: "approval-setting-changed",
      detailsJson: JSON.stringify({ setting: TEACHER_TOPIC_APPROVAL, from: before, to: value, targetLabel: TEACHER_TOPIC_APPROVAL_LABEL }),
    }).run();
    return { ...settingsFrom(tx), changed: true };
  });
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function settingErrorResponse(error: unknown): Response {
  if (error instanceof SettingError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "Settings are temporarily unavailable. Please retry.", errorBn: "সেটিংস এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}
