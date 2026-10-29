"use client";

import { useLanguage } from "@/lib/use-language";

const notes = {
  intro: {
    en: "Learning topics show their source books and notes beside the reading. A source citation is supporting evidence: it points to the material a topic draws on.",
    bn: "শেখার বিষয়গুলোতে পড়ার পাশেই উৎস বই ও নোট দেখানো হয়। উৎসের উল্লেখ হলো সহায়ক প্রমাণ: বিষয়টি কোন উপকরণ থেকে নেওয়া, তা দেখায়।",
  },
  approval: {
    en: "Teachers check the topics. A new or changed topic appears for students only after a teacher or administrator has previewed all of it in English and Bangla and approved it. A source citation supports a topic; it does not mean the NCTB has approved it.",
    bn: "শিক্ষকেরা বিষয়গুলো যাচাই করেন। নতুন বা বদলানো কোনো বিষয় শিক্ষার্থীরা তখনই দেখে, যখন একজন শিক্ষক বা প্রশাসক পুরোটা ইংরেজি ও বাংলায় দেখে অনুমোদন দেন। উৎসের উল্লেখ বিষয়টিকে সমর্থন করে; এর মানে এই নয় যে এনসিটিবি বিষয়টি অনুমোদন করেছে।",
  },
};

/** The notes about sources and topic approval, in the reader's language. */
export default function ReferenceNote({ note }: { note: keyof typeof notes }) {
  const [language] = useLanguage();
  return <p lang={language}>{notes[note][language]}</p>;
}
