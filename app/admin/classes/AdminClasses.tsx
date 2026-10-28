"use client";
import { useEffect, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import ClassAllocation from "@/app/components/ClassAllocation";
import { confirmDiscardPasswords } from "@/app/components/StudentImport";
import { useLanguage } from "@/lib/use-language";
export default function AdminClasses({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage();
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  // Choosing another class remounts the panel, which would discard temporary passwords on screen.
  const [passwordsOnScreen, setPasswordsOnScreen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/classes?scope=all", { signal: controller.signal }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setClasses(data.classes); }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  return <PortalShell role="admin" name={name} active="classes" language={language} toggleLanguage={toggleLanguage}>
    <h1>Class allocation</h1><p>Allocate registered students to a teacher’s class. Existing learning records are retained when access is removed.</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <label className="portal-field">Choose a class<select value={selected} onChange={(e) => { if (passwordsOnScreen && !confirmDiscardPasswords(language)) return; setSelected(e.target.value); }}><option value="">Select a class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {!classes.length && !error && <p>Teachers create classes from their workspace. Classes will appear here.</p>}
    {selected && <ClassAllocation key={selected} classId={selected} language={language} onPasswordsChange={setPasswordsOnScreen} />}
  </PortalShell>;
}
