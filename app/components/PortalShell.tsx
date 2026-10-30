"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Language } from "@/lib/use-language";
export type PortalRole = "student" | "teacher" | "admin" | "parent";
const PortalLanguage = createContext<Language>("en");
/** The portal's language, for page parts that cannot read it themselves (such as server-rendered pages). */
export function usePortalLanguage() { return useContext(PortalLanguage); }
type Item = { id: string; label: string; href?: string; onClick?: () => void };
/** The class open in the teacher workspace, whose sections the sidebar lists under its name. */
export type OpenClass = { name: string; sections: Item[] };
type Group = { id: string; label?: string; items: Item[]; openClass?: OpenClass };
const roleLabels: Record<PortalRole, [string, string]> = {
  student: ["Student", "শিক্ষার্থী"],
  teacher: ["Teacher", "শিক্ষক"],
  admin: ["Admin", "প্রশাসক"],
  parent: ["Parent", "অভিভাবক"],
};
/**
 * The portal sidebar. `items` replaces the role's own links (the student portal's sections). Staff see the
 * same groups on every page: administrators "Administration" and "Teacher workspace", teachers "Teacher
 * workspace" and "Lessons & topics". On /teach, `classes` replaces the link to the class list with an in-page
 * button, and `openClass` lists the open class's sections under its name; with no class open there are none.
 */
export default function PortalShell({ role, name, language, toggleLanguage, active, items, classes, openClass, children }: {
  role: PortalRole; name: string; language: Language; toggleLanguage: () => void; active?: string; items?: Item[]; classes?: Item; openClass?: OpenClass; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const home = role === "student" ? "/student" : role === "admin" ? "/admin" : role === "teacher" ? "/teach" : "/family";
  // On a phone the open menu covers the page: Escape closes it and returns to the Menu button.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menu.current?.focus(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const workspace: Group = { id: "workspace", label: s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র"), openClass, items: [
    classes ?? { id: "classes", label: role === "admin" ? s("All classes", "সব ক্লাস") : s("My classes", "আমার ক্লাস"), href: "/teach" },
  ] };
  const lessons = { id: "lessons", label: s("Lessons", "পাঠ"), href: "/studio" };
  const content = { id: "content", label: s("Topics", "বিষয়"), href: "/teach/topics" };
  const studentTopics = { id: "topics", label: s("Learning topics", "শেখার বিষয়"), href: "/topics" };
  // Administrator ids differ from the teacher workspace's section ids, so only one item is marked current.
  const groups: Group[] = role === "admin" ? [
    { id: "administration", label: s("Administration", "প্রশাসন"), items: [
      { id: "admin-users", label: s("Users", "ব্যবহারকারী"), href: "/admin" },
      { id: "admin-classes", label: s("Class allocation", "ক্লাস বরাদ্দ"), href: "/admin/classes" },
      { id: "admin-results", label: s("Grades & results", "গ্রেড ও ফলাফল"), href: "/admin/results" },
      lessons,
      content,
      { id: "admin-sources", label: s("Textbook links", "পাঠ্যবইয়ের লিংক"), href: "/admin/sources" },
    ] },
    workspace,
  ] : role === "teacher" ? [
    workspace,
    { id: "materials", label: s("Lessons & topics", "পাঠ ও বিষয়"), items: [
      lessons,
      content,
      // The approved topics as students read them; "Topics" above is where staff write and approve them.
      { id: "topics", label: s("Topics as students see them", "শিক্ষার্থীর চোখে বিষয়"), href: "/topics" },
    ] },
  ] : role === "student" ? [{ id: "student", items: items ? [...items, ...(items.some((item) => item.id === "topics") ? [] : [studentTopics])] : [
    { id: "learning", label: s("My Learning", "আমার শেখা"), href: "/student" },
    { id: "activities", label: s("My activities", "আমার কার্যক্রম"), href: "/student?section=activities" },
    { id: "results", label: s("My results", "আমার ফলাফল"), href: "/student?section=results" },
    studentTopics,
  ] }] : [{ id: "parent", items: items ?? [{ id: "family", label: s("My children", "আমার সন্তান"), href: "/family" }] }];
  const end: Item[] = [
    { id: "references", label: s("Sources & references", "উৎস ও তথ্যসূত্র"), href: "/references" },
    role === "student" ? { id: "password", label: s("Change password", "পাসওয়ার্ড বদলাও"), href: "/student/password" } : { id: "account", label: s("Account & recovery", "অ্যাকাউন্ট ও পুনরুদ্ধার"), href: "/account" },
  ];
  const link = (item: Item) => item.href
    ? <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined} onClick={() => setOpen(false)}>{item.label}</Link>
    : <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onClick={() => { item.onClick?.(); setOpen(false); }}>{item.label}</button>;
  return <div className="portal-shell" lang={language}>
    <a className="skip-link" href="#portal-main">{s("Skip to content", "মূল অংশে যান")}</a>
    <aside className={`portal-sidebar ${open ? "is-open" : ""}`}>
      <Link className="portal-brand" href={home}><span aria-hidden="true">বা</span><strong>Bangla<br />Adventures</strong></Link>
      <p className="portal-role">{s(`${roleLabels[role][0]} portal`, `${roleLabels[role][1]} পোর্টাল`)}</p>
      <nav id="portal-navigation" aria-label={s("Portal navigation", "পোর্টালের মেনু")}>
        {groups.map((group) => group.label
          ? <div key={group.id} className="portal-nav-group" role="group" aria-labelledby={`portal-nav-${group.id}`}>
            <p className="portal-nav-heading" id={`portal-nav-${group.id}`}>{group.label}</p>
            {group.items.map(link)}
            {group.openClass && <div className="portal-nav-class" role="group" aria-labelledby="portal-nav-open-class">
              <p className="portal-nav-class-name"><small>{s("Open class", "খোলা ক্লাস")}</small><span id="portal-nav-open-class">{group.openClass.name}</span></p>
              {group.openClass.sections.map(link)}
            </div>}
          </div>
          : <div key={group.id} className="portal-nav-group">{group.items.map(link)}</div>)}
        <div className="portal-nav-group portal-nav-end">{end.map(link)}</div>
      </nav>
      <a className="portal-signout" href={role === "student" ? "/api/student/sign-out?returnTo=%2Fstudent" : "/api/auth/sign-out?returnTo=%2Fgrown-ups"}>{s("Sign out", "সাইন আউট")}</a>
    </aside>
    <div className="portal-workspace">
      <header className="portal-topbar"><button ref={menu} className="portal-menu" type="button" aria-expanded={open} aria-controls="portal-navigation" onClick={() => setOpen(!open)}>{s("Menu", "মেনু")}</button><span>{s("Welcome", "স্বাগতম")}, <strong>{name}</strong></span><button lang={language === "bn" ? "en" : "bn"} className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
      <div id="portal-main" className="portal-content"><PortalLanguage value={language}>{children}</PortalLanguage></div>
    </div>
  </div>;
}
