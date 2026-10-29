/**
 * Class announcements and who reads them. A teacher or administrator posts to everyone in the class
 * (its students and their linked parents), to the students only or to the parents only. Pure code,
 * shared by the API routes and the portals.
 */

export const ANNOUNCEMENT_AUDIENCES = ["all", "students", "parents"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export type AnnouncementReader = "student" | "parent";
export const ANNOUNCEMENT_MAX_LENGTH = 2000;

/** The audiences a reader sees: students never see parents-only posts, and parents never see students-only posts. */
export function audiencesFor(reader: AnnouncementReader): AnnouncementAudience[] {
  return reader === "student" ? ["all", "students"] : ["all", "parents"];
}

export function isAnnouncementAudience(value: unknown): value is AnnouncementAudience {
  return typeof value === "string" && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(value);
}

export function isVisibleTo(audience: string, reader: AnnouncementReader): boolean {
  return (audiencesFor(reader) as string[]).includes(audience);
}

/** The choices in the composer, in English and Bangla. */
export const AUDIENCE_CHOICES: Record<AnnouncementAudience, [string, string]> = {
  all: ["Everyone in the class (students and parents)", "ক্লাসের সবাই (শিক্ষার্থী ও অভিভাবক)"],
  students: ["Students only", "শুধু শিক্ষার্থীরা"],
  parents: ["Parents only", "শুধু অভিভাবকেরা"],
};

/** The short badge on a posted announcement. */
export const AUDIENCE_BADGES: Record<AnnouncementAudience, [string, string]> = {
  all: ["Students and parents", "শিক্ষার্থী ও অভিভাবক"],
  students: ["Students only", "শুধু শিক্ষার্থী"],
  parents: ["Parents only", "শুধু অভিভাবক"],
};

/** The confirmation after posting. */
export const POSTED_MESSAGES: Record<AnnouncementAudience, [string, string]> = {
  all: ["Announcement posted to everyone in the class.", "ঘোষণাটি ক্লাসের সবার কাছে পাঠানো হয়েছে।"],
  students: ["Announcement posted to the students.", "ঘোষণাটি শিক্ষার্থীদের কাছে পাঠানো হয়েছে।"],
  parents: ["Announcement posted to the parents.", "ঘোষণাটি অভিভাবকদের কাছে পাঠানো হয়েছে।"],
};

export type AnnouncementInput = { body: string; audience: AnnouncementAudience };
export type AnnouncementInputError = { error: string; errorBn: string };

/**
 * A new announcement from a request body `{ body, audience }`: the text is trimmed (line breaks kept)
 * and must be 1–2000 characters; a missing audience means everyone in the class.
 */
export function parseAnnouncement(payload: unknown): AnnouncementInput | AnnouncementInputError {
  const data = (payload && typeof payload === "object" ? payload : {}) as { body?: unknown; audience?: unknown };
  const body = typeof data.body === "string" ? data.body.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) return { error: "Write the announcement first.", errorBn: "আগে ঘোষণাটি লিখুন।" };
  if (body.length > ANNOUNCEMENT_MAX_LENGTH) {
    return { error: `Keep the announcement to ${ANNOUNCEMENT_MAX_LENGTH} characters or fewer.`, errorBn: "ঘোষণাটি ২০০০ অক্ষরের মধ্যে রাখুন।" };
  }
  const audience = data.audience === undefined ? "all" : data.audience;
  if (!isAnnouncementAudience(audience)) return { error: "Choose who the announcement is for.", errorBn: "ঘোষণাটি কার জন্য, তা বেছে নিন।" };
  return { body, audience };
}
