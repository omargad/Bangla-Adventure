import { count, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, appSettings, classActivities, classSources, userAuditEvents } from "../db/schema";
import type { Bilingual } from "../app/topics-content";
import { canPublishContent, canTeach } from "./roles";

/**
 * Approval settings an administrator changes in the "Who needs approval" panel (on the Topics page and on
 * Administration › Who needs approval). There are three, one per kind of teachers' work:
 *
 * - "Teachers' topics need an administrator's approval" (lib/curriculum-catalog.ts),
 * - "Teachers' class activities need an administrator's approval" (lib/class-activities.ts),
 * - "Teachers' class sources need an administrator's approval" (lib/class-sources.ts).
 *
 * Each is on by default, and a setting without a stored row (an installation from before it, or one where
 * nobody has changed it) is on, so nothing is published unreviewed by an upgrade. An administrator's own
 * work never waits, whatever the settings say.
 */
export const TEACHER_TOPIC_APPROVAL = "teacher-topics-need-approval";
export const TEACHER_TOPIC_APPROVAL_LABEL: Bilingual = {
  en: "Teachers' topics need an administrator's approval",
  bn: "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন প্রয়োজন",
};
export const TEACHER_ACTIVITY_APPROVAL = "teacher-class-activities-need-approval";
export const TEACHER_ACTIVITY_APPROVAL_LABEL: Bilingual = {
  en: "Teachers' class activities need an administrator's approval",
  bn: "শিক্ষকদের ক্লাসের কার্যক্রমে প্রশাসকের অনুমোদন প্রয়োজন",
};
export const TEACHER_SOURCE_APPROVAL = "teacher-class-sources-need-approval";
export const TEACHER_SOURCE_APPROVAL_LABEL: Bilingual = {
  en: "Teachers' class sources need an administrator's approval",
  bn: "শিক্ষকদের ক্লাসের উৎসে প্রশাসকের অনুমোদন প্রয়োজন",
};

/** The field each setting has in the API, the key it is stored and audited under, and its label. */
export const APPROVAL_SETTINGS = [
  {
    field: "teacherTopicsNeedApproval", key: TEACHER_TOPIC_APPROVAL, label: TEACHER_TOPIC_APPROVAL_LABEL,
    invalid: { en: "Choose whether teachers' topics need an administrator's approval.", bn: "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন লাগবে কি না, বেছে নিন।" },
  },
  {
    field: "teacherActivitiesNeedApproval", key: TEACHER_ACTIVITY_APPROVAL, label: TEACHER_ACTIVITY_APPROVAL_LABEL,
    invalid: { en: "Choose whether teachers' class activities need an administrator's approval.", bn: "শিক্ষকদের ক্লাসের কার্যক্রমে প্রশাসকের অনুমোদন লাগবে কি না, বেছে নিন।" },
  },
  {
    field: "teacherSourcesNeedApproval", key: TEACHER_SOURCE_APPROVAL, label: TEACHER_SOURCE_APPROVAL_LABEL,
    invalid: { en: "Choose whether teachers' class sources need an administrator's approval.", bn: "শিক্ষকদের ক্লাসের উৎসে প্রশাসকের অনুমোদন লাগবে কি না, বেছে নিন।" },
  },
] as const;
export type ApprovalField = (typeof APPROVAL_SETTINGS)[number]["field"];
export type ApprovalKey = (typeof APPROVAL_SETTINGS)[number]["key"];

/** Who last changed one setting and when; null while it has its default. */
export type SettingChange = { changedByName: string | null; changedAt: string } | null;

export type ApprovalSettings = {
  /** A teacher's new or edited topic waits for an administrator before students see it. */
  teacherTopicsNeedApproval: boolean;
  /** A teacher's new class activity waits for an administrator before students and parents see it. */
  teacherActivitiesNeedApproval: boolean;
  /** A teacher's new or edited class source waits for an administrator before students and parents see it. */
  teacherSourcesNeedApproval: boolean;
  /** Who last changed the topics setting and when; null while it has its default (kept as it was before there were three). */
  changedByName: string | null;
  changedAt: string | null;
  /** Who last changed each setting and when. */
  lastChanged: Record<ApprovalField, SettingChange>;
};

export class SettingError extends Error {
  constructor(message: string, public messageBn: string, public status = 400) { super(message); }
}

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;

function storedRow(db: Reader, key: ApprovalKey) {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get();
}

/** Whether this kind of teachers' work waits for approval. Only a stored `false` turns it off: a missing or unreadable value keeps it on. */
export function approvalRequired(db: Reader, key: ApprovalKey): boolean {
  const row = storedRow(db, key);
  if (!row) return true;
  try { return JSON.parse(row.valueJson) !== false; } catch { return true; }
}

/** Whether teachers' topics wait for approval. */
export function teacherTopicsNeedApproval(db: Reader): boolean { return approvalRequired(db, TEACHER_TOPIC_APPROVAL); }
/** Whether teachers' class activities wait for approval. */
export function teacherActivitiesNeedApproval(db: Reader): boolean { return approvalRequired(db, TEACHER_ACTIVITY_APPROVAL); }
/** Whether teachers' class sources wait for approval. */
export function teacherSourcesNeedApproval(db: Reader): boolean { return approvalRequired(db, TEACHER_SOURCE_APPROVAL); }

/**
 * What happens to class work this account saves: "admin" (an administrator's own work, approved at once),
 * "setting" (an approved teacher's, approved at once because the setting for this kind of work is off) or
 * "review" (it waits for an administrator). The caller has already checked that the account may manage the class.
 */
export type ContentPublication = "admin" | "setting" | "review";
type Account = Parameters<typeof canPublishContent>[0];
export function publicationFor(db: Reader, actor: Account, key: ApprovalKey): ContentPublication {
  if (canPublishContent(actor)) return "admin";
  if (actor && canTeach(actor) && actor.approvalStatus === "approved" && !actor.mustChangePassword && !approvalRequired(db, key)) return "setting";
  return "review";
}

/**
 * What saving this kind of work does for this account now, and whether teachers' work of this kind waits for approval,
 * for the wording of the page it is written on. The save itself decides again (see publicationFor).
 */
export async function publishingFor(actorId: string, key: ApprovalKey): Promise<{ onSave: ContentPublication; teachersNeedApproval: boolean }> {
  const db = await getDb();
  return { onSave: publicationFor(db, db.select().from(adults).where(eq(adults.id, actorId)).get() ?? null, key), teachersNeedApproval: approvalRequired(db, key) };
}

function settingsFrom(db: Reader): ApprovalSettings {
  const rows = db.select().from(appSettings).where(inArray(appSettings.key, APPROVAL_SETTINGS.map((setting) => setting.key))).all();
  const ids = [...new Set(rows.map((row) => row.updatedBy).filter((id): id is string => Boolean(id)))];
  const names = new Map(ids.length ? db.select({ id: adults.id, name: adults.displayName }).from(adults).where(inArray(adults.id, ids)).all().map((row) => [row.id, row.name]) : []);
  const change = (key: ApprovalKey): SettingChange => {
    const row = rows.find((item) => item.key === key);
    return row ? { changedByName: row.updatedBy ? names.get(row.updatedBy) ?? null : null, changedAt: row.updatedAt } : null;
  };
  const lastChanged = Object.fromEntries(APPROVAL_SETTINGS.map((setting) => [setting.field, change(setting.key)])) as Record<ApprovalField, SettingChange>;
  return {
    teacherTopicsNeedApproval: teacherTopicsNeedApproval(db),
    teacherActivitiesNeedApproval: teacherActivitiesNeedApproval(db),
    teacherSourcesNeedApproval: teacherSourcesNeedApproval(db),
    changedByName: lastChanged.teacherTopicsNeedApproval?.changedByName ?? null,
    changedAt: lastChanged.teacherTopicsNeedApproval?.changedAt ?? null,
    lastChanged,
  };
}

export async function getApprovalSettings(): Promise<ApprovalSettings> {
  return settingsFrom(await getDb());
}

/** Teachers' class activities and class sources still waiting for an administrator, in every class. */
export async function waitingClassContent(): Promise<{ activities: number; sources: number }> {
  const db = await getDb();
  return {
    activities: db.select({ value: count() }).from(classActivities).where(eq(classActivities.approvalStatus, "pending")).get()?.value ?? 0,
    sources: db.select({ value: count() }).from(classSources).where(eq(classSources.approvalStatus, "pending")).get()?.value ?? 0,
  };
}

/**
 * An administrator turns any of the settings on or off: { teacherTopicsNeedApproval?, teacherActivitiesNeedApproval?,
 * teacherSourcesNeedApproval? }, each a boolean, at least one given. The account is checked again inside the
 * transaction (an active, approved administrator without a temporary password), and each setting that changes is
 * audited as approval-setting-changed with its old and new value; one given its current value writes nothing.
 * Work already waiting stays waiting either way: turning approval off approves only what teachers save from then on.
 */
export async function setApprovalSettings(actorId: string, raw: unknown): Promise<ApprovalSettings & { changed: boolean; changedSettings: ApprovalField[] }> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const given = APPROVAL_SETTINGS.filter((setting) => body[setting.field] !== undefined);
  if (!given.length) {
    throw new SettingError("Choose whether teachers' topics, class activities or class sources need an administrator's approval.", "শিক্ষকদের বিষয়, ক্লাসের কার্যক্রম বা ক্লাসের উৎসে প্রশাসকের অনুমোদন লাগবে কি না, বেছে নিন।");
  }
  for (const setting of given) {
    if (typeof body[setting.field] !== "boolean") throw new SettingError(setting.invalid.en, setting.invalid.bn);
  }
  const db = await getDb();
  return db.transaction((tx) => {
    const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword }).from(adults).where(eq(adults.id, actorId)).get();
    if (!actor || !canPublishContent(actor)) throw new SettingError("Only an administrator can change who needs approval.", "কার অনুমোদন লাগবে, তা শুধু প্রশাসক বদলাতে পারেন।", 403);
    const changedSettings: ApprovalField[] = [];
    const updatedAt = new Date().toISOString();
    for (const setting of given) {
      const value = body[setting.field] as boolean;
      const before = approvalRequired(tx, setting.key);
      if (before === value) continue;
      tx.insert(appSettings).values({ key: setting.key, valueJson: JSON.stringify(value), updatedBy: actorId, updatedAt })
        .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(value), updatedBy: actorId, updatedAt } }).run();
      tx.insert(userAuditEvents).values({
        id: crypto.randomUUID(), actorId, targetId: setting.key, targetType: "setting", action: "approval-setting-changed",
        detailsJson: JSON.stringify({ setting: setting.key, from: before, to: value, targetLabel: setting.label }),
      }).run();
      changedSettings.push(setting.field);
    }
    return { ...settingsFrom(tx), changed: changedSettings.length > 0, changedSettings };
  });
}

/** The topics setting alone, as the API took it before there were three ({ teacherTopicsNeedApproval: boolean }). */
export async function setTeacherTopicApproval(actorId: string, raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as { teacherTopicsNeedApproval?: unknown }).teacherTopicsNeedApproval : undefined;
  if (typeof value !== "boolean") throw new SettingError(APPROVAL_SETTINGS[0].invalid.en, APPROVAL_SETTINGS[0].invalid.bn);
  return setApprovalSettings(actorId, { teacherTopicsNeedApproval: value });
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function settingErrorResponse(error: unknown): Response {
  if (error instanceof SettingError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "Settings are temporarily unavailable. Please retry.", errorBn: "সেটিংস এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}
