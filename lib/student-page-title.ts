type StudentTitle = [en: string, bn: string];

const titles: Record<string, StudentTitle> = {
  learning: ["My Learning | Bangla Adventures", "আমার শেখা | Bangla Adventures"],
  activities: ["My activities | Bangla Adventures", "আমার কার্যক্রম | Bangla Adventures"],
  results: ["My results | Bangla Adventures", "আমার ফলাফল | Bangla Adventures"],
  "sign-in": ["Student login | Bangla Adventures", "শিক্ষার্থীর সাইন ইন | Bangla Adventures"],
  "sign-up": ["Create student account | Bangla Adventures", "শিক্ষার্থীর অ্যাকাউন্ট তৈরি | Bangla Adventures"],
};

export function studentPageTitle(signedIn: boolean, section = "learning", mode = "sign-in"): StudentTitle {
  if (!signedIn) return mode === "sign-up" ? titles["sign-up"] : titles["sign-in"];
  return section === "activities" ? titles.activities : section === "results" ? titles.results : titles.learning;
}

/** Only rewrite titles belonging to this portal, never a destination page's metadata. */
export function isStudentPageTitle(title: string): boolean {
  return Object.values(titles).some((pair) => pair.includes(title));
}
