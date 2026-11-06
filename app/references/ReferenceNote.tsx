"use client";

import { useLanguage } from "@/lib/use-language";

const notes = {
  intro: {
    en: "Learning topics show their source books and notes beside the reading. A source citation is supporting evidence: it points to the material a topic draws on.",
    bn: "শেখার বিষয়গুলোতে পড়ার পাশেই উৎস বই ও নোট দেখানো হয়। উৎসের উল্লেখ হলো সহায়ক প্রমাণ: বিষয়টি কোন উপকরণ থেকে নেওয়া, তা দেখায়।",
  },
  approval: {
    en: "Only administrators approve topics. A topic an administrator writes or edits is published at once. A teacher's new or changed topic appears for students after an administrator has read all of it in English and Bangla and approved it, unless an administrator has switched that approval off. A source citation supports a topic; it does not mean the NCTB has approved it.",
    bn: "শুধু প্রশাসকেরা বিষয় অনুমোদন করেন। প্রশাসক কোনো বিষয় লিখলে বা সম্পাদনা করলে তা সঙ্গে সঙ্গে প্রকাশিত হয়। শিক্ষকের নতুন বা বদলানো বিষয় শিক্ষার্থীরা তখনই দেখে, যখন একজন প্রশাসক পুরোটা ইংরেজি ও বাংলায় পড়ে অনুমোদন দেন, যদি না প্রশাসক এই অনুমোদন বন্ধ করে রাখেন। উৎসের উল্লেখ বিষয়টিকে সমর্থন করে; এর মানে এই নয় যে এনসিটিবি বিষয়টি অনুমোদন করেছে।",
  },
};

/** The notes about sources and topic approval, in the reader's language. */
export default function ReferenceNote({ note }: { note: keyof typeof notes }) {
  const [language] = useLanguage();
  return <p lang={language}>{notes[note][language]}</p>;
}
