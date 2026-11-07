"use client";
import Link from "next/link";
import PortalShell from "@/app/components/PortalShell";
import ApprovalSetting from "@/app/teach/topics/ApprovalSetting";
import { useLanguage } from "@/lib/use-language";

/**
 * Administration › Who needs approval: the three approval switches in one place (the same panel is on the Topics page),
 * and where an administrator reviews what is waiting. The settings live on the server; this page only shows them.
 */
export default function AdminApprovals({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Who needs approval | Bangla Adventures", "কার অনুমোদন লাগবে | Bangla Adventures"] });
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  return <PortalShell role="admin" name={name} active="admin-approvals" language={language} toggleLanguage={toggleLanguage}>
    <h1>{s("Who needs approval", "কার অনুমোদন লাগবে")}</h1>
    <p>{s("Choose whether teachers' topics, class activities and class sources wait for an administrator before students and parents see them. Lessons, recordings and videos always wait for an administrator.", "শিক্ষকদের বিষয়, ক্লাসের কার্যক্রম ও ক্লাসের উৎস শিক্ষার্থী ও অভিভাবকদের দেখার আগে প্রশাসকের অপেক্ষায় থাকবে কি না, তা বেছে নিন। পাঠ, রেকর্ডিং ও ভিডিও সবসময় প্রশাসকের অপেক্ষায় থাকে।")}</p>
    <ApprovalSetting language={language} heading={false} />
    <p className="teach-note">{s("Review what is waiting: topics on the ", "অপেক্ষায় থাকা কাজ পর্যালোচনা করুন: বিষয় ")}
      <Link href="/teach/topics">{s("Topics page", "“বিষয়” পাতায়")}</Link>
      {s("; class activities and class sources in their class under ", "; ক্লাসের কার্যক্রম ও উৎস ")}
      <Link href="/teach">{s("All classes", "“সব ক্লাস”")}</Link>
      {s(" (Activities & quizzes, Class sources).", " থেকে ক্লাস খুলে (কার্যক্রম ও কুইজ, ক্লাসের উৎস)।")}</p>
  </PortalShell>;
}
