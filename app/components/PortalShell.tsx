"use client";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Language } from "@/lib/use-language";
export type PortalRole = "student" | "teacher" | "admin" | "parent";
type Item = { id: string; label: string; href?: string; onClick?: () => void };
const roleLabels: Record<PortalRole, [string, string]> = {
  student: ["Student", "শিক্ষার্থী"],
  teacher: ["Teacher", "শিক্ষক"],
  admin: ["Admin", "প্রশাসক"],
  parent: ["Parent", "অভিভাবক"],
};
export default function PortalShell({ role, name, language, toggleLanguage, active, items, children }: {
  role: PortalRole; name: string; language: Language; toggleLanguage: () => void; active?: string; items?: Item[]; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const home = role === "student" ? "/student" : role === "admin" ? "/admin" : role === "teacher" ? "/teach" : "/family";
  const defaults: Item[] = role === "admin" ? [
    { id: "users", label: s("Users", "ব্যবহারকারী"), href: "/admin" },
    { id: "classes", label: s("Class allocation", "ক্লাস বরাদ্দ"), href: "/admin/classes" },
    { id: "results", label: s("Grades & results", "গ্রেড ও ফলাফল"), href: "/admin/results" },
    { id: "content", label: s("Lessons & topics", "পাঠ ও বিষয়"), href: "/teach/topics" },
    { id: "teach", label: s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র"), href: "/teach" },
  ] : role === "student" ? [
    { id: "learning", label: s("My Learning", "আমার শেখা"), href: "/student" },
    { id: "activities", label: s("My activities", "আমার কার্যক্রম"), href: "/student?section=activities" },
    { id: "results", label: s("My results", "আমার ফলাফল"), href: "/student?section=results" },
    { id: "topics", label: s("Learning topics", "শেখার বিষয়"), href: "/topics" },
  ] : role === "teacher" ? [
    { id: "classes", label: s("My classes", "আমার ক্লাস"), href: "/teach" },
    { id: "content", label: s("Lessons & topics", "পাঠ ও বিষয়"), href: "/teach/topics" },
    { id: "topics", label: s("Learning topics", "শেখার বিষয়"), href: "/topics" },
  ] : [{ id: "family", label: s("My children", "আমার সন্তান"), href: "/family" }];
  const primary = items ?? defaults;
  const topics = role === "student" ? defaults.filter((item) => item.id === "topics" && !primary.some((entry) => entry.id === item.id)) : [];
  const navigation = [...primary, ...topics, { id: "references", label: s("Sources & references", "উৎস ও তথ্যসূত্র"), href: "/references" }, ...(role === "student" ? [{ id: "password", label: s("Change password", "পাসওয়ার্ড বদলাও"), href: "/student/password" }] : [{ id: "account", label: s("Account & recovery", "অ্যাকাউন্ট ও পুনরুদ্ধার"), href: "/account" }])];
  return <div className="portal-shell" lang={language}>
    <a className="skip-link" href="#portal-main">{s("Skip to content", "মূল অংশে যান")}</a>
    <aside className={`portal-sidebar ${open ? "is-open" : ""}`}>
      <Link className="portal-brand" href={home}><span aria-hidden="true">বা</span><strong>Bangla<br />Adventures</strong></Link>
      <p className="portal-role">{s(`${roleLabels[role][0]} portal`, `${roleLabels[role][1]} পোর্টাল`)}</p>
      <nav id="portal-navigation" aria-label="Portal navigation">{navigation.map((item, index) => item.href
        ? <Link key={`${item.id}-${index}`} href={item.href} aria-current={active === item.id ? "page" : undefined} onClick={() => setOpen(false)}>{item.label}</Link>
        : <button key={`${item.id}-${index}`} aria-current={active === item.id ? "page" : undefined} onClick={() => { item.onClick?.(); setOpen(false); }}>{item.label}</button>)}</nav>
      <a className="portal-signout" href={role === "student" ? "/api/student/sign-out?returnTo=%2Fstudent" : "/api/auth/sign-out?returnTo=%2Fgrown-ups"}>{s("Sign out", "সাইন আউট")}</a>
    </aside>
    <div className="portal-workspace">
      <header className="portal-topbar"><button className="portal-menu" type="button" aria-expanded={open} aria-controls="portal-navigation" onClick={() => setOpen(!open)}>{s("Menu", "মেনু")}</button><span>{s("Welcome", "স্বাগতম")}, <strong>{name}</strong></span><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
      <div id="portal-main" className="portal-content">{children}</div>
    </div>
  </div>;
}
