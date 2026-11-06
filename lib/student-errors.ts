import { serverError } from "./request-security";

/**
 * The 500 answer of the student routes (feed, results, submit), in the informal voice used with students.
 * The database's own message stays in the server log: it can name tables and columns ("no such column: …"
 * carries no SQLITE code), and is no use to a student.
 */
const MESSAGES = {
  setup: { error: "The student service is still being set up. Please try again later.", errorBn: "শিক্ষার্থী সেবাটি এখনো চালু করা হচ্ছে। পরে আবার চেষ্টা করো।" },
  read: { error: "Your class information is not available right now. Try again in a moment.", errorBn: "তোমার ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করো।" },
  submit: { error: "Your answers could not be saved right now. Try again in a moment.", errorBn: "তোমার উত্তর এখন সংরক্ষণ করা যায়নি। একটু পরে আবার চেষ্টা করো।" },
} as const;

export function studentServerError(context: string, error: unknown, kind: "read" | "submit" = "read"): Response {
  const message = error instanceof Error ? error.message : "";
  return serverError(context, error, { ...MESSAGES[message.includes("no such table") ? "setup" : kind] });
}
