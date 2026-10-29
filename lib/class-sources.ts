import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, classSources, classStudents, parentStudentLinks, studentClassEnrollments, students, userAuditEvents } from "../db/schema";
import type { Bilingual } from "../app/topics-content";
import { linkProblem } from "./library-links";
import { managedClass, type Staff } from "./class-access";

/**
 * Per-class sources: links a class's teacher (or an administrator) adds for one
 * class. Students see the sources of the classes they are actively allocated to,
 * and parents those of their linked children's classes; nobody else does. The
 * global NCTB catalogue stays with administrators (lib/library-catalog.ts).
 */

export const CLASS_SOURCE_LIMITS = { title: 120, note: 300, perClass: 50 } as const;

export type ClassSource = { id: string; classId: string; titleEn: string; titleBn: string; url: string; host: string; note: string; createdAt: string };
export type ClassSourceInput = { titleEn: string; titleBn: string; url: string; note: string };

export class ClassSourceError extends Error {
  constructor(message: string, readonly messageBn: string, readonly status = 400) { super(message); }
}
const refuse = (text: Bilingual, status = 400) => new ClassSourceError(text.en, text.bn, status);
type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** A class source from the form: a title in at least one language, an HTTPS link and an optional note. */
export function validateClassSource(raw: Record<string, unknown>): ClassSourceInput {
  const titleEn = text(raw.titleEn), titleBn = text(raw.titleBn), url = text(raw.url), note = text(raw.note);
  if (!titleEn && !titleBn) throw refuse({ en: "Give the source a title in English or Bangla.", bn: "উৎসের একটি নাম ইংরেজি বা বাংলায় দিন।" });
  if (titleEn.length > CLASS_SOURCE_LIMITS.title || titleBn.length > CLASS_SOURCE_LIMITS.title) {
    throw refuse({ en: `Titles can be at most ${CLASS_SOURCE_LIMITS.title} characters.`, bn: `নাম সর্বোচ্চ ${CLASS_SOURCE_LIMITS.title.toLocaleString("bn-BD")} অক্ষরের হতে পারে।` });
  }
  if (!url) throw refuse({ en: "Add the link (https://…).", bn: "লিংক (https://…) দিন।" });
  const problem = linkProblem(url);
  if (problem) throw refuse(problem);
  if (note.length > CLASS_SOURCE_LIMITS.note) {
    throw refuse({ en: `The note can be at most ${CLASS_SOURCE_LIMITS.note} characters.`, bn: `নোট সর্বোচ্চ ${CLASS_SOURCE_LIMITS.note.toLocaleString("bn-BD")} অক্ষরের হতে পারে।` });
  }
  return { titleEn, titleBn, url, note };
}

type Row = typeof classSources.$inferSelect;
const view = (row: Row): ClassSource => {
  let host = "";
  try { host = new URL(row.url).hostname; } catch { /* stored links were validated */ }
  return { id: row.id, classId: row.classId, titleEn: row.titleEn, titleBn: row.titleBn, url: row.url, host, note: row.note, createdAt: row.createdAt };
};

/** The sources of these classes, oldest first. Callers decide who may see which classes. */
export async function sourcesOf(classIds: string[]): Promise<ClassSource[]> {
  if (!classIds.length) return [];
  const db = await getDb();
  return db.select().from(classSources).where(inArray(classSources.classId, classIds)).orderBy(asc(classSources.createdAt), asc(classSources.id)).all().map(view);
}

function audit(tx: Transaction, actorId: string, classId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: classId, targetType: "class", action, detailsJson: JSON.stringify(details) }).run();
}

/** The sources of a class the actor manages, or null when they do not manage it. */
export async function listClassSources(actor: Staff, classId: string): Promise<ClassSource[] | null> {
  const db = await getDb();
  if (!db.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) return null;
  return sourcesOf([classId]);
}

/** Add a source to a class the actor manages (null when they do not). */
export async function addClassSource(actor: Staff, classId: string, raw: Record<string, unknown>): Promise<ClassSource | null> {
  const db = await getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) return null;
    const input = validateClassSource(raw);
    const count = tx.select({ id: classSources.id }).from(classSources).where(eq(classSources.classId, classId)).all().length;
    if (count >= CLASS_SOURCE_LIMITS.perClass) {
      throw refuse({ en: `A class can have at most ${CLASS_SOURCE_LIMITS.perClass} sources. Remove one first.`, bn: `একটি ক্লাসে সর্বোচ্চ ${CLASS_SOURCE_LIMITS.perClass.toLocaleString("bn-BD")}টি উৎস রাখা যায়। আগে একটি সরান।` });
    }
    const row = tx.insert(classSources).values({ id: crypto.randomUUID(), classId, ...input, createdBy: actor.id, createdAt: new Date().toISOString() }).returning().get();
    audit(tx, actor.id, classId, "class-source-added", { sourceId: row.id, url: row.url });
    return view(row);
  });
}

/** Change a source of a class the actor manages (null when the class or source is not theirs). */
export async function updateClassSource(actor: Staff, classId: string, sourceId: string, raw: Record<string, unknown>): Promise<ClassSource | null> {
  const db = await getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) return null;
    const before = tx.select().from(classSources).where(and(eq(classSources.id, sourceId), eq(classSources.classId, classId))).get();
    if (!before) return null;
    const input = validateClassSource(raw);
    const row = tx.update(classSources).set(input).where(eq(classSources.id, sourceId)).returning().get();
    audit(tx, actor.id, classId, "class-source-updated", { sourceId, ...(before.url !== row.url ? { oldUrl: before.url, newUrl: row.url } : {}) });
    return view(row);
  });
}

/** Remove a source from a class the actor manages; false when the class or source is not theirs. */
export async function removeClassSource(actor: Staff, classId: string, sourceId: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction((tx) => {
    if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) return false;
    const removed = tx.delete(classSources).where(and(eq(classSources.id, sourceId), eq(classSources.classId, classId))).returning().get();
    if (!removed) return false;
    audit(tx, actor.id, classId, "class-source-removed", { sourceId, url: removed.url });
    return true;
  });
}

/** A student's active classes with their sources ("My class sources"); removed allocations are left out. */
export async function studentClassSources(studentId: string) {
  const db = await getDb();
  const rows = db.select({ classId: classes.id, className: classes.name, teacherName: adults.displayName })
    .from(studentClassEnrollments)
    .innerJoin(students, eq(studentClassEnrollments.studentId, students.id))
    .innerJoin(classes, eq(studentClassEnrollments.classId, classes.id))
    .innerJoin(classStudents, and(eq(studentClassEnrollments.classStudentId, classStudents.id), eq(classStudents.classId, classes.id)))
    .innerJoin(adults, eq(classes.teacherId, adults.id))
    .where(and(eq(studentClassEnrollments.studentId, studentId), eq(studentClassEnrollments.active, true), eq(students.status, "active")))
    .orderBy(asc(classes.name), asc(classes.id)).all();
  const sources = await sourcesOf(rows.map((row) => row.classId));
  return rows.map((row) => ({ ...row, sources: sources.filter((source) => source.classId === row.classId) }));
}
export type StudentClassSources = Awaited<ReturnType<typeof studentClassSources>>;

/**
 * The sources of every class a parent's linked children are actively allocated to,
 * by class id. Only an active parent account has linked children.
 */
export async function parentClassSources(parentId: string): Promise<Record<string, ClassSource[]>> {
  const db = await getDb();
  const parent = db.select({ id: adults.id }).from(adults).where(and(eq(adults.id, parentId), eq(adults.role, "parent"), eq(adults.status, "active"))).get();
  if (!parent) throw refuse({ en: "Parent access required.", bn: "অভিভাবকের অ্যাকাউন্ট দরকার।" }, 403);
  const rows = db.select({ classId: studentClassEnrollments.classId })
    .from(parentStudentLinks)
    .innerJoin(studentClassEnrollments, eq(parentStudentLinks.studentId, studentClassEnrollments.studentId))
    .innerJoin(classStudents, and(eq(studentClassEnrollments.classStudentId, classStudents.id), eq(classStudents.classId, studentClassEnrollments.classId)))
    .where(and(eq(parentStudentLinks.parentId, parent.id), eq(studentClassEnrollments.active, true))).all();
  const classIds = [...new Set(rows.map((row) => row.classId))];
  const byClass: Record<string, ClassSource[]> = Object.fromEntries(classIds.map((id) => [id, []]));
  for (const source of await sourcesOf(classIds)) byClass[source.classId].push(source);
  return byClass;
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function classSourceErrorResponse(error: unknown): Response {
  if (error instanceof ClassSourceError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "Class sources are temporarily unavailable. Please retry.", errorBn: "ক্লাসের উৎস এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}
