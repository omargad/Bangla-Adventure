import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "../db";
import { adults, classAnnouncements, classes } from "../db/schema";
import { audiencesFor, type AnnouncementAudience, type AnnouncementInput, type AnnouncementReader } from "./announcements";
import { managedClass, type Staff } from "./class-access";
import { auditClass } from "./class-audit";
import type { Tx } from "./enrollments";

export type ClassAnnouncement = { id: string; classId: string; body: string; audience: AnnouncementAudience; authorName: string | null; createdAt: string };

const author = alias(adults, "announcement_author");
/** How much of a post the audit row keeps, so Recent changes shows what reached students and parents. */
export const ANNOUNCEMENT_AUDIT_EXCERPT = 200;

/**
 * Announcements in these classes, newest first: every audience for staff, or only the posts meant for
 * a student or a parent. The author is the teacher or administrator who posted (older posts were given
 * their class teacher when authors started being kept). It is null once the author's account is
 * deleted: the post is never credited to whoever teaches the class now.
 */
export function listAnnouncements(reader: Pick<Tx, "select">, classIds: string[], audienceOf?: AnnouncementReader): ClassAnnouncement[] {
  if (!classIds.length) return [];
  return reader.select({
    id: classAnnouncements.id, classId: classAnnouncements.classId, body: classAnnouncements.body, audience: classAnnouncements.audience,
    authorName: author.displayName, createdAt: classAnnouncements.createdAt,
  }).from(classAnnouncements)
    .leftJoin(author, eq(author.id, classAnnouncements.authorId))
    .where(and(inArray(classAnnouncements.classId, classIds), audienceOf ? inArray(classAnnouncements.audience, audiencesFor(audienceOf)) : undefined))
    // Posts in the same second keep the order they were written in.
    .orderBy(desc(classAnnouncements.createdAt), desc(sql`${classAnnouncements}.rowid`))
    .all();
}

/**
 * Post to a class this actor manages, credited to the actor. A post reaches its students and parents
 * at once, without review, so it is audited as announcement-posted with its audience and the start of
 * its text. Returns null when the actor does not manage the class.
 */
export async function postAnnouncement(actor: Staff, classId: string, input: AnnouncementInput) {
  const db = await getDb();
  return db.transaction((tx) => {
    const classroom = tx.select({ id: classes.id, name: classes.name }).from(classes).where(managedClass(actor, classId)).get();
    if (!classroom) return null;
    const row = tx.insert(classAnnouncements).values({ id: crypto.randomUUID(), classId, body: input.body, audience: input.audience, authorId: actor.id }).returning().get();
    auditClass(tx, actor.id, classId, "announcement-posted", { announcementId: row.id, audience: row.audience, excerpt: row.body.slice(0, ANNOUNCEMENT_AUDIT_EXCERPT) }, classroom.name);
    return row;
  });
}

/**
 * Remove a post from a class this actor manages. It disappears for every student and parent, so it is
 * audited as announcement-removed. Returns null when the class or the post is not the actor's to manage.
 */
export async function removeAnnouncement(actor: Staff, classId: string, announcementId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    const classroom = tx.select({ id: classes.id, name: classes.name }).from(classes).where(managedClass(actor, classId)).get();
    if (!classroom) return null;
    const row = tx.delete(classAnnouncements).where(and(eq(classAnnouncements.id, announcementId), eq(classAnnouncements.classId, classId))).returning().get();
    if (row) auditClass(tx, actor.id, classId, "announcement-removed", { announcementId: row.id, audience: row.audience, authorId: row.authorId }, classroom.name);
    return row ?? null;
  });
}
