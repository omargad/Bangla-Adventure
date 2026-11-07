import type { Bilingual } from "@/app/topics-content";

/**
 * What saving a class activity or class source does for the signed-in account, as the class API reports it:
 * "admin" (an administrator's own work, approved at once), "setting" (an approved teacher's, approved at once because
 * an administrator has switched off "Teachers' class activities need an administrator's approval" or "Teachers' class
 * sources need an administrator's approval") or "review" (it waits for an administrator).
 */
export type ClassPublication = "admin" | "setting" | "review";
/** What a save answered: how it was published at once, or null when it waits for an administrator. */
export type PublishedDirectly = "admin" | "setting" | null;

/** The line under "Activities & quizzes" in the class workspace, from what a save does and whether teachers' activities wait. */
export function activitiesIntro(onSave: ClassPublication, teachersNeedApproval: boolean): Bilingual {
  if (onSave === "admin" && !teachersNeedApproval) return {
    en: "Approval for teachers' class activities is off, so a teacher's new activity is published to their class as soon as they save it. Students and parents see only approved activities.",
    bn: "শিক্ষকদের ক্লাসের কার্যক্রমের অনুমোদন বন্ধ, তাই শিক্ষক নতুন কার্যক্রম সংরক্ষণ করলেই তা তাঁর ক্লাসে প্রকাশিত হয়। শিক্ষার্থী ও অভিভাবকেরা শুধু অনুমোদিত কার্যক্রম দেখেন।",
  };
  if (onSave === "setting") return {
    en: "An administrator has switched off approval for teachers' class activities, so your new activities are published to the class as soon as you save them. Students and parents see only approved activities.",
    bn: "প্রশাসক শিক্ষকদের ক্লাসের কার্যক্রমের অনুমোদন বন্ধ রেখেছেন, তাই আপনার নতুন কার্যক্রম সংরক্ষণের সঙ্গে সঙ্গে ক্লাসে প্রকাশিত হয়। শিক্ষার্থী ও অভিভাবকেরা শুধু অনুমোদিত কার্যক্রম দেখেন।",
  };
  return {
    en: "Teachers submit activities for Admin approval. Students and parents see only approved activities.",
    bn: "শিক্ষকেরা প্রশাসকের অনুমোদনের জন্য কার্যক্রম জমা দেন। শিক্ষার্থী ও অভিভাবকেরা শুধু অনুমোদিত কার্যক্রম দেখেন।",
  };
}

/** The note above the new-activity form: whether a new activity waits for approval or is published at once. */
export function activityFormNote(onSave: ClassPublication): Bilingual {
  if (onSave === "admin") return { en: "Publishing records your Admin approval of this activity.", bn: "প্রকাশ করলে এই কার্যক্রমে আপনার প্রশাসনিক অনুমোদন নথিভুক্ত হবে।" };
  if (onSave === "setting") return {
    en: "Teachers' class activities do not need an administrator's approval at the moment: your activity is published to the class as soon as you save it, and students can answer it while it is open.",
    bn: "এখন শিক্ষকদের ক্লাসের কার্যক্রমে প্রশাসকের অনুমোদন লাগে না: সংরক্ষণের সঙ্গে সঙ্গে আপনার কার্যক্রম ক্লাসে প্রকাশিত হবে, আর খোলা থাকা পর্যন্ত শিক্ষার্থীরা উত্তর দিতে পারবে।",
  };
  return { en: "Submit your activity for Admin review. It stays hidden from students and parents until approved.", bn: "কার্যক্রম প্রশাসকের পর্যালোচনার জন্য জমা দিন। অনুমোদনের আগে শিক্ষার্থী ও অভিভাবকদের কাছে এটি লুকানো থাকবে।" };
}

/** The new-activity form's button. */
export function activitySaveButton(onSave: ClassPublication): Bilingual {
  if (onSave === "admin") return { en: "Approve and publish to the class", bn: "অনুমোদন দিয়ে ক্লাসে প্রকাশ করুন" };
  if (onSave === "setting") return { en: "Publish to the class", bn: "ক্লাসে প্রকাশ করুন" };
  return { en: "Submit for Admin approval", bn: "প্রশাসকের অনুমোদনের জন্য জমা দিন" };
}

/** What the teacher or administrator is told after adding an activity: published now, or waiting for an administrator. */
export function activitySavedMessage(publishedDirectly: PublishedDirectly): Bilingual {
  if (publishedDirectly === "admin") return { en: "Activity approved and published to the class.", bn: "কার্যক্রম অনুমোদিত হয়ে ক্লাসে প্রকাশিত হয়েছে।" };
  if (publishedDirectly === "setting") return {
    en: "Activity published to the class. Students and parents see it now, and students can answer it while it is open: teachers' class activities do not need an administrator's approval at the moment.",
    bn: "কার্যক্রম ক্লাসে প্রকাশিত হয়েছে। শিক্ষার্থী ও অভিভাবকেরা এখনই এটি দেখবেন, আর খোলা থাকা পর্যন্ত শিক্ষার্থীরা উত্তর দিতে পারবে: এখন শিক্ষকদের ক্লাসের কার্যক্রমে প্রশাসকের অনুমোদন লাগে না।",
  };
  return { en: "Activity submitted for Admin approval. Students and parents cannot see it yet.", bn: "কার্যক্রম প্রশাসকের অনুমোদনের জন্য জমা হয়েছে। শিক্ষার্থী ও অভিভাবকেরা এখনও এটি দেখতে পাবেন না।" };
}

/**
 * Whether an administrator sent this source back (or withdrew it) and has not approved it since: it is rejected, or a
 * teacher has edited it since and it waits again with the administrator's note kept (an edit of any other source
 * clears the note). A teacher's edit of such a source always waits for an administrator, even while approval for
 * teachers' class sources is off; only an administrator shows it again.
 */
export function sentBackSource(source: { approvalStatus: "pending" | "approved" | "rejected"; reviewNote: string }): boolean {
  return source.approvalStatus === "rejected" || (source.approvalStatus === "pending" && source.reviewNote !== "");
}

/** What saving this source does for this account: a teacher's edit of a source sent back waits (see sentBackSource). */
export function sourceEditPublication(onSave: ClassPublication, source: Parameters<typeof sentBackSource>[0] | null): ClassPublication {
  return onSave === "setting" && source && sentBackSource(source) ? "review" : onSave;
}

/** The note above the form while a teacher edits a source an administrator sent back, when it would otherwise be shown at once. */
export function sentBackEditNote(): Bilingual {
  return {
    en: "An administrator sent this source back, so your edit waits for an administrator's approval even though approval for teachers' class sources is off. Students and parents do not see it until an administrator approves it.",
    bn: "প্রশাসক এই উৎসটি ফেরত পাঠিয়েছেন, তাই শিক্ষকদের ক্লাসের উৎসের অনুমোদন বন্ধ থাকলেও আপনার সম্পাদনা প্রশাসকের অনুমোদনের অপেক্ষায় থাকবে। প্রশাসক অনুমোদন না দেওয়া পর্যন্ত শিক্ষার্থী ও অভিভাবকেরা এটি দেখতে পাবেন না।",
  };
}

/** The line at the top of Class sources, from what a save does and whether teachers' sources wait. */
export function sourcesIntro(onSave: ClassPublication, teachersNeedApproval: boolean): Bilingual {
  if (onSave === "admin" && !teachersNeedApproval) return {
    en: "Add class learning links, such as a worksheet, video or textbook page. Approval for teachers' class sources is off, so a source a teacher adds or edits is shown at once to allocated students in Sources & references and to their linked parents. A teacher's edit of a source you sent back still waits for your approval.",
    bn: "ওয়ার্কশিট, ভিডিও বা পাঠ্যবইয়ের পাতার মতো ক্লাসের শেখার লিংক যোগ করুন। শিক্ষকদের ক্লাসের উৎসের অনুমোদন বন্ধ, তাই শিক্ষক কোনো উৎস যোগ বা সম্পাদনা করলে তা সঙ্গে সঙ্গে বরাদ্দ শিক্ষার্থী ও সংযুক্ত অভিভাবকদের কাছে দেখা যায়। তবে আপনি যে উৎস ফেরত পাঠিয়েছেন, শিক্ষক তা সম্পাদনা করলে আপনার অনুমোদনের অপেক্ষায় থাকবে।",
  };
  if (onSave === "setting") return {
    en: "Add class learning links, such as a worksheet, video or textbook page. An administrator has switched off approval for teachers' class sources, so a source you add or edit is shown at once to allocated students in Sources & references and to their linked parents. An edit of a source an administrator sent back still waits for an administrator's approval.",
    bn: "ওয়ার্কশিট, ভিডিও বা পাঠ্যবইয়ের পাতার মতো ক্লাসের শেখার লিংক যোগ করুন। প্রশাসক শিক্ষকদের ক্লাসের উৎসের অনুমোদন বন্ধ রেখেছেন, তাই আপনি কোনো উৎস যোগ বা সম্পাদনা করলে তা সঙ্গে সঙ্গে বরাদ্দ শিক্ষার্থী ও সংযুক্ত অভিভাবকদের কাছে দেখা যায়। তবে প্রশাসক যে উৎস ফেরত পাঠিয়েছেন, তার সম্পাদনা প্রশাসকের অনুমোদনের অপেক্ষায় থাকবে।",
  };
  return {
    en: "Submit class learning links, such as a worksheet, video or textbook page, for Admin approval. Only approved sources appear for allocated students in Sources & references and for their linked parents. Teacher edits need approval again.",
    bn: "ওয়ার্কশিট, ভিডিও বা পাঠ্যবইয়ের পাতার মতো ক্লাসের শেখার লিংক প্রশাসকের অনুমোদনের জন্য জমা দিন। শুধু অনুমোদিত উৎস বরাদ্দ শিক্ষার্থী ও সংযুক্ত অভিভাবকদের কাছে দেখা যাবে। শিক্ষকের সম্পাদনার পর আবার অনুমোদন লাগবে।",
  };
}

/** The source form's button. */
export function sourceSaveButton(onSave: ClassPublication): Bilingual {
  if (onSave === "admin") return { en: "Approve and save source", bn: "উৎস অনুমোদন ও সংরক্ষণ করুন" };
  if (onSave === "setting") return { en: "Save and show to the class", bn: "সংরক্ষণ করে ক্লাসকে দেখান" };
  return { en: "Submit source for Admin approval", bn: "প্রশাসকের অনুমোদনের জন্য উৎস জমা দিন" };
}

/** What the teacher or administrator is told after adding or editing a source. */
export function sourceSavedMessage(publishedDirectly: PublishedDirectly, edited: boolean): Bilingual {
  if (publishedDirectly === "admin") return edited
    ? { en: "Source updated and approved.", bn: "উৎস হালনাগাদ ও অনুমোদিত হয়েছে।" }
    : { en: "Source approved and published. Students in this class and their parents can see it now.", bn: "উৎস অনুমোদিত ও প্রকাশিত হয়েছে। এই ক্লাসের শিক্ষার্থী ও তাদের অভিভাবকেরা এখন এটি দেখতে পাবেন।" };
  if (publishedDirectly === "setting") return edited
    ? { en: "Source updated. Students in this class and their parents see the change now: teachers' class sources do not need an administrator's approval at the moment.", bn: "উৎস হালনাগাদ হয়েছে। এই ক্লাসের শিক্ষার্থী ও তাদের অভিভাবকেরা এখনই পরিবর্তনটি দেখবেন: এখন শিক্ষকদের ক্লাসের উৎসে প্রশাসকের অনুমোদন লাগে না।" }
    : { en: "Source published. Students in this class and their parents can see it now: teachers' class sources do not need an administrator's approval at the moment.", bn: "উৎস প্রকাশিত হয়েছে। এই ক্লাসের শিক্ষার্থী ও তাদের অভিভাবকেরা এখনই এটি দেখতে পাবেন: এখন শিক্ষকদের ক্লাসের উৎসে প্রশাসকের অনুমোদন লাগে না।" };
  return edited
    ? { en: "Source updated and submitted for Admin approval. It is hidden until approved again.", bn: "উৎস হালনাগাদ করে প্রশাসকের অনুমোদনের জন্য জমা হয়েছে। আবার অনুমোদনের আগে এটি লুকানো থাকবে।" }
    : { en: "Source submitted for Admin approval. Students and parents cannot see it yet.", bn: "উৎস প্রশাসকের অনুমোদনের জন্য জমা হয়েছে। শিক্ষার্থী ও অভিভাবকেরা এখনও এটি দেখতে পাবেন না।" };
}
