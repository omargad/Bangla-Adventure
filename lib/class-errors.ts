import { UserManagementError } from "./user-management";

/**
 * The 500 answer of the class routes. The database's own message stays in the server log: it can
 * name tables, columns and constraints, and is no use to a teacher. A known refusal
 * (UserManagementError) keeps its status and bilingual message.
 */
const MESSAGES = {
  classes: {
    setup: ["The classroom service is still being set up.", "ক্লাসরুম সেবাটি এখনো চালু করা হচ্ছে।"],
    failed: ["Class information is not available right now. Please try again in a moment.", "ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।"],
  },
  grades: {
    setup: ["The grades service is still being set up.", "গ্রেড সেবাটি এখনো চালু করা হচ্ছে।"],
    failed: ["Grades are not available right now. Please try again in a moment.", "গ্রেডের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।"],
  },
} as const;

export type ClassErrorArea = keyof typeof MESSAGES;

export function classServerError(error: unknown, area: ClassErrorArea = "classes"): Response {
  if (error instanceof UserManagementError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  console.error(`[${area}]`, error);
  const message = error instanceof Error ? error.message : "";
  const [en, bn] = MESSAGES[area][message.includes("no such table") ? "setup" : "failed"];
  return Response.json({ error: en, errorBn: bn }, { status: 500 });
}
