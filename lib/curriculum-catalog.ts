import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, topicUpdates, userAuditEvents } from "../db/schema";
import { topics, type Topic } from "../app/topics-content";
import { bookById, NCTB_PORTAL_URL } from "../app/library-content";
import { UserManagementError } from "./user-management";

export type CatalogTopic = Topic & { version: number; updatedAt: string | null };
const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new UserManagementError(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
};
const bilingual = (value: unknown, label: string, max: number) => {
  if (!value || typeof value !== "object") throw new UserManagementError(`${label} needs English and Bangla text.`);
  const pair = value as Record<string, unknown>;
  return { en: text(pair.en, `${label} (English)`, max), bn: text(pair.bn, `${label} (Bangla)`, max) };
};
export function validateTopicEdit(raw: Record<string, unknown>) {
  const baseline = topics.find((topic) => topic.id === raw.id);
  if (!baseline) throw new UserManagementError("Choose an existing topic.", 404);
  if (!Number.isInteger(raw.version) || Number(raw.version) < 0) throw new UserManagementError("Reload the topic before saving.");
  if (!Number.isInteger(raw.minutes) || Number(raw.minutes) < 1 || Number(raw.minutes) > 60) throw new UserManagementError("Reading time must be 1–60 minutes.");
  if (!Array.isArray(raw.sections) || raw.sections.length < 1 || raw.sections.length > 12) throw new UserManagementError("Provide 1–12 reading sections.");
  const sections = raw.sections.map((section, index) => {
    if (!section || typeof section !== "object") throw new UserManagementError(`Section ${index + 1} is invalid.`);
    return { heading: bilingual(section.heading, `Section ${index + 1} heading`, 160), body: bilingual(section.body, `Section ${index + 1} text`, 8000) };
  });
  return { ...baseline, title: bilingual(raw.title, "Title", 160), tagline: bilingual(raw.tagline, "Introduction", 500), minutes: Number(raw.minutes), sections };
}
export async function getCatalog(): Promise<CatalogTopic[]> {
  const db = await getDb();
  const changes = new Map(db.select().from(topicUpdates).all().map((row) => [row.topicId, row]));
  return topics.map((baseline) => {
    const update = changes.get(baseline.id);
    if (!update) return { ...baseline, version: 0, updatedAt: null };
    const stored = JSON.parse(update.dataJson);
    return { ...validateTopicEdit({ ...stored, id: baseline.id, version: update.version }), version: update.version, updatedAt: update.updatedAt };
  });
}
export async function saveTopic(actorId: string, body: Record<string, unknown>) {
  const topic = validateTopicEdit(body);
  const db = await getDb();
  return db.transaction((tx) => {
    const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
    if (actor?.role !== "admin" || actor.status !== "active") throw new UserManagementError("Administrator access required.", 403);
    const previous = tx.select().from(topicUpdates).where(eq(topicUpdates.topicId, topic.id)).get();
    if ((previous?.version ?? 0) !== body.version) throw new UserManagementError("Another administrator changed this topic. Reload before saving.", 409);
    const version = (previous?.version ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    tx.insert(topicUpdates).values({ topicId: topic.id, dataJson: JSON.stringify(topic), version, updatedAt }).onConflictDoUpdate({
      target: topicUpdates.topicId, set: { dataJson: JSON.stringify(topic), version, updatedAt },
    }).run();
    tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: topic.id, targetType: "topic", action: "topic-preview-updated", detailsJson: JSON.stringify({ version }) }).run();
    return { ...topic, version, updatedAt };
  });
}
export function topicReferences(topic: Topic) {
  return topic.sources.map((source) => ({ bookId: source.bookId, title: bookById(source.bookId)?.titleEn ?? source.bookId, note: source.note, url: NCTB_PORTAL_URL }));
}
