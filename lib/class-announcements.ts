import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { adults, classAnnouncements } from "../db/schema";
import { audiencesFor, type AnnouncementAudience, type AnnouncementReader } from "./announcements";
import type { Tx } from "./enrollments";

export type ClassAnnouncement = { id: string; classId: string; body: string; audience: AnnouncementAudience; authorName: string | null; createdAt: string };

const author = alias(adults, "announcement_author");

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
