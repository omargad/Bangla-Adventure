import { eq } from "drizzle-orm";
import { classes, userAuditEvents } from "../db/schema";
import type { Tx } from "./enrollments";

/**
 * Write one audit row about a class, inside the caller's transaction. The class name is stored with
 * the row as `targetLabel` ({ en, bn }; a class has one name in both languages), so Recent changes can
 * still name the class after it is deleted. Pass `name` when the caller already has it (or the class
 * row is gone); otherwise it is read from the class.
 */
export function auditClass(tx: Tx, actorId: string, classId: string, action: string, details: Record<string, unknown>, name?: string) {
  const label = name ?? tx.select({ name: classes.name }).from(classes).where(eq(classes.id, classId)).get()?.name;
  tx.insert(userAuditEvents).values({
    id: crypto.randomUUID(), actorId, targetId: classId, targetType: "class", action,
    detailsJson: JSON.stringify(label ? { ...details, targetLabel: { en: label, bn: label } } : details),
  }).run();
}
