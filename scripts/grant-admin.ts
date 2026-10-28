import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, adultSessions, userAuditEvents } from "../db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run admin:grant -- <existing-account-email>");
  process.exit(1);
}
const db = await getDb();
const granted = db.transaction((tx) => {
  const user = tx.select({ id: adults.id }).from(adults).where(and(eq(adults.email, email), eq(adults.status, "active"))).get();
  if (!user) return false;
  tx.update(adults).set({ role: "admin", teacherStatus: "none" }).where(eq(adults.id, user.id)).run();
  tx.delete(adultSessions).where(eq(adultSessions.adultId, user.id)).run();
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), targetId: user.id, targetType: "adult", action: "administrator-granted-by-server-operator" }).run();
  return true;
});
if (!granted) {
  console.error("No active account matched. Register the intended owner through the website first.");
  process.exit(1);
}
console.log("Administrator access granted. Sign in again; previous sessions have been revoked.");
