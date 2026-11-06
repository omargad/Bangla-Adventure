import { accountHome, type AccountAccess } from "./roles";

/** Where a signed-in reader's own home is, with its name as [English, Bangla]. */
export type HomeLink = { href: string; label: [en: string, bn: string] };

const ADULT_HOMES: Record<string, HomeLink["label"]> = {
  "/admin": ["Administration", "প্রশাসন"],
  "/teach": ["Teacher workspace", "শিক্ষকের কর্মক্ষেত্র"],
  "/family": ["Grown-up dashboard", "বড়দের ড্যাশবোর্ড"],
};

/**
 * The home link shared pages (worksheets, the adventure) show: a student's My Learning, or a grown-up's
 * own home by role. A grown-up session wins when both are signed in, as in LearningLayout. Null when
 * neither can use the site yet (signed out, or a student still on a temporary password).
 */
export function homeLink(adult: AccountAccess | null, student: { mustChangePassword: boolean } | null): HomeLink | null {
  if (adult) {
    const href = accountHome(adult);
    return { href, label: ADULT_HOMES[href] ?? ADULT_HOMES["/family"] };
  }
  if (student && !student.mustChangePassword) return { href: "/student", label: ["My Learning", "আমার শেখা"] };
  return null;
}
