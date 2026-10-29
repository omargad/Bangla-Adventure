"use client";
import { useEffect, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import ClassAllocation from "@/app/components/ClassAllocation";
import { confirmDiscardPasswords } from "@/app/components/StudentImport";
import { localMessage, useLanguage } from "@/lib/use-language";
export default function AdminClasses({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [classes, setClasses] = useState<{ id: string; name: string; teacherName?: string }[]>([]);
  const [selected, setSelected] = useState("");
  // The server's error as sent, shown in the page language.
  const [error, setError] = useState<{ error?: string; errorBn?: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Choosing another class remounts the panel, which would discard temporary passwords on screen.
  const [passwordsOnScreen, setPasswordsOnScreen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/classes?scope=all", { signal: controller.signal }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data); return; }
      setClasses(data.classes); setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setError({}); });
    return () => controller.abort();
  }, []);
  return <PortalShell role="admin" name={name} active="classes" language={language} toggleLanguage={toggleLanguage}>
    <h1>{s("Class allocation", "ক্লাস বরাদ্দ")}</h1><p>{s("Allocate registered students to a teacher’s class. Existing learning records are retained when access is removed.", "নিবন্ধিত শিক্ষার্থীদের কোনো শিক্ষকের ক্লাসে বরাদ্দ করুন। প্রবেশাধিকার সরালেও আগের শেখার রেকর্ড থেকে যায়।")}</p>
    {error && <p role="alert" className="auth-error">{localMessage(error, language, ["Classes could not be loaded. Please reload the page.", "ক্লাসগুলো লোড করা যায়নি। পাতাটি আবার লোড করুন।"])}</p>}
    <label className="portal-field">{s("Choose a class", "একটি ক্লাস বেছে নিন")}<select value={selected} onChange={(e) => { if (passwordsOnScreen && !confirmDiscardPasswords(language)) return; setSelected(e.target.value); }}><option value="">{s("Select a class", "ক্লাস বাছাই করুন")}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.teacherName ? `${c.name} · ${c.teacherName}` : c.name}</option>)}</select></label>
    {loaded && !classes.length && <p>{s("Teachers create classes from their workspace. Classes will appear here.", "শিক্ষকেরা তাঁদের কর্মক্ষেত্র থেকে ক্লাস তৈরি করেন। ক্লাসগুলো এখানে দেখা যাবে।")}</p>}
    {selected && <ClassAllocation key={selected} classId={selected} language={language} onPasswordsChange={setPasswordsOnScreen} />}
  </PortalShell>;
}
