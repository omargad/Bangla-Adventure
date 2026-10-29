import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { adults, classAnnouncements, classes } from "../db/schema";
import { audiencesFor, type AnnouncementAudience, type AnnouncementReader } from "./announcements";
import type { Tx } from "./enrollments";

export type ClassAnnouncement = { id: string; classId: string; body: string; audience: AnnouncementAudience; authorName: string; createdAt: string };

const author = alias(adults, "announcement_author");
const classTeacher = alias(adults, "announcement_class_teacher");

/**
 * Announcements in these classes, newest first: every audience for staff, or only the posts meant for
 * a student or a parent. The author is the teacher or administrator who posted; posts without one
 * (from before authors were kept, or by a deleted account) credit the class teacher.
 */
export function listAnnouncements(reader: Pick<Tx, "select">, classIds: string[], audienceOf?: AnnouncementReader): ClassAnnouncement[] {
  if (!classIds.length) return [];
  return reader.select({
    id: classAnnouncements.id, classId: classAnnouncements.classId, body: classAnnouncements.body, audience: classAnnouncements.audience,
    authorName: sql<string>`coalesce(${author.displayName}, ${classTeacher.displayName})`, createdAt: classAnnouncements.createdAt,
  }).from(classAnnouncements)
    .innerJoin(classes, eq(classes.id, classAnnouncements.classId))
    .innerJoin(classTeacher, eq(classTeacher.id, classes.teacherId))
    .leftJoin(author, eq(author.id, classAnnouncements.authorId))
    .where(and(inArray(classAnnouncements.classId, classIds), audienceOf ? inArray(classAnnouncements.audience, audiencesFor(audienceOf)) : undefined))
    // Posts in the same second keep the order they were written in.
    .orderBy(desc(classAnnouncements.createdAt), desc(sql`${classAnnouncements}.rowid`))
    .all();
}
