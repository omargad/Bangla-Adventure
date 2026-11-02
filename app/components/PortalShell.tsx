"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Language } from "@/lib/use-language";
import { isReturn, keepOffset, keptOffset, takeReturn } from "@/lib/portal-scroll";
export type PortalRole = "student" | "teacher" | "admin" | "parent";
const PortalLanguage = createContext<Language>("en");
/** The portal's language, for page parts that cannot read it themselves (such as server-rendered pages). */
export function usePortalLanguage() { return useContext(PortalLanguage); }
type Item = { id: string; label: string; href?: string; onClick?: () => void };
/** The class open in the teacher workspace, whose sections the sidebar lists under its name. */
export type OpenClass = { name: string; sections: Item[] };
type Group = { id: string; label?: string; items: Item[]; openClass?: OpenClass; more?: Item[] };
const roleLabels: Record<PortalRole, [string, string]> = {
  student: ["Student", "শিক্ষার্থী"],
  teacher: ["Teacher", "শিক্ষক"],
  admin: ["Admin", "প্রশাসক"],
  parent: ["Parent", "অভিভাবক"],
};
// For each address shown in this tab, the address its page was opened at (see toTop below). The two differ where a page changes
// its own search params, as the lesson and topic studios do, and Back to such an address must know the first one again.
const openedAt = new Map<string, string>();
// Only the iPhone and iPad rules in app/portal.css make the main column scroll. Elsewhere the shell leaves scrolling to the browser
// and never reads the column's offset: that alone makes the browser lay the page out at once, which can change where its own Back
// and Forward land. Checking the column's style needs no layout.
const scrolls = (main: HTMLElement) => getComputedStyle(main).overflowY !== "visible";
/**
 * The portal sidebar. `items` replaces the role's own links (the student portal's sections). Staff see the
 * same groups on every page: administrators "Administration" and "Teacher workspace", teachers "Teacher
 * workspace" and "Lessons & topics". On /teach, `classes` replaces the link to the class list with an in-page
 * button, and `openClass` lists the open class's sections under its name; with no class open there are none.
 * "Home learners" (/family) is the learner-profile dashboard staff also use, which no other portal page links to.
 */
export default function PortalShell({ role, name, language, toggleLanguage, active, items, classes, openClass, children }: {
  role: PortalRole; name: string; language: Language; toggleLanguage: () => void; active?: string; items?: Item[]; classes?: Item; openClass?: OpenClass; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const column = useRef<HTMLDivElement>(null);
  // The address the column shows (a path and its search params), the same with its #part (if any), under which the column's
  // offset is kept, the address the page was opened at, and an address a link asked to show from the top (see toTop below).
  const shown = useRef("");
  const entry = useRef("");
  const opened = useRef("");
  const fromTop = useRef("");
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const home = role === "student" ? "/student" : role === "admin" ? "/admin" : role === "teacher" ? "/teach" : "/family";
  // On a phone the open menu covers the page: focus moves into it (to the current item) and the page behind is
  // inert. Escape closes it and returns to the Menu button; widening the window past the phone layout closes it.
  useEffect(() => {
    if (!open) return;
    (nav.current?.querySelector<HTMLElement>("[aria-current=page]") ?? nav.current?.querySelector<HTMLElement>("a,button"))?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menu.current?.focus(); } };
    const phone = window.matchMedia("(max-width: 650px)");
    const widened = () => { if (!phone.matches) setOpen(false); };
    window.addEventListener("keydown", close);
    phone.addEventListener("change", widened);
    return () => { window.removeEventListener("keydown", close); phone.removeEventListener("change", widened); };
  }, [open]);
  // The pathname makes the shell render on every navigation, even where a layout keeps it (/worksheets and its worksheets), and
  // the search params whenever only they change, even where the page itself does not render again (the lesson and topic
  // studios keep showing what they show). So this runs whenever the address changes.
  const pathname = usePathname();
  useSearchParams();
  useLayoutEffect(() => {
    const main = column.current!;
    if (!scrolls(main)) return;
    const address = pathname + location.search, linked = fromTop.current === address;
    if (shown.current === address && !linked) {
      // A link to this same page from one of its parts adds an entry without the #part, with no popstate or hashchange. The new
      // entry is kept where the column is, whether or not the reader scrolls there; Back, Forward and reloads are handled below
      // and by moved().
      if (history.state !== null && entry.current !== address + location.hash && !isReturn()) {
        entry.current = address + location.hash;
        keepOffset(entry.current, main.scrollTop);
      }
      return;
    }
    fromTop.current = "";
    let top = linked ? 0 : null, visit = false;
    if (shown.current !== address) {
      const first = !shown.current;
      shown.current = address;
      entry.current = address + location.hash;
      if (takeReturn()) {
        opened.current = openedAt.get(address) ?? address;
        // A column that moved while a reloaded page was still loading stays where it is. A computer no longer puts the page back
        // once the reader has scrolled it, and on a reload at a #part it may stay at the part.
        if (first && main.scrollTop > 0) visit = true;
        else top = keptOffset(entry.current);
      } else {
        // Another page opening here is opened at this address; a page changing its own search params (history.replaceState)
        // and a link toTop handles are not.
        if (opened.current !== pathname && !opened.current.startsWith(`${pathname}?`)) opened.current = address;
        visit = true;
      }
    }
    openedAt.set(address, opened.current);
    if (top !== null) main.scrollTo({ top, behavior: "instant" });
    // A new visit is kept where the column now is (the top, or where the reader scrolled while the page was still loading),
    // not where an earlier visit to this address was left.
    if (visit) keepOffset(entry.current, main.scrollTop);
  });
  useLayoutEffect(() => {
    const main = column.current!;
    const keep = () => {
      // The router can take a #part off without popstate or hashchange (a link to this same page from one of its parts). The
      // browser's own entries for #links are the only ones with no history state, and those are moved()'s to follow.
      if (history.state !== null && location.pathname + location.search === shown.current) entry.current = shown.current + location.hash;
      keepOffset(entry.current, main.scrollTop);
    };
    // A link to a part of this page (#...), such as Skip to content, adds a history entry for the same page, and the browser
    // scrolls the column to that part. Back and Forward between such entries move only the page's own scroll, so the column is
    // put back here; a link just followed is left where the browser puts it. A click that opens a new tab or window, or a link to
    // the part already shown, adds no entry here.
    let linkedAt = -Infinity;
    const clicked = (event: globalThis.MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      linkedAt = plain && link instanceof HTMLAnchorElement && link.hash && link.hash !== location.hash && link.pathname === location.pathname && link.search === location.search ? performance.now() : -Infinity;
    };
    const moved = () => {
      // Another page or other search params are the layout effect's to handle, once the router shows them. Where the column does
      // not scroll, the layout effect shows no address, so nothing here runs.
      if (location.pathname + location.search !== shown.current) return;
      takeReturn();
      const now = shown.current + location.hash, followed = performance.now() - linkedAt < 1000;
      linkedAt = -Infinity;
      if (now === entry.current) return;
      entry.current = now;
      if (followed) keep();
      else main.scrollTo({ top: keptOffset(now), behavior: "instant" });
    };
    main.addEventListener("scroll", keep, { passive: true });
    document.addEventListener("click", clicked, true);
    window.addEventListener("popstate", moved);
    window.addEventListener("hashchange", moved);
    return () => {
      main.removeEventListener("scroll", keep);
      document.removeEventListener("click", clicked, true);
      window.removeEventListener("popstate", moved);
      window.removeEventListener("hashchange", moved);
    };
  }, []);
  // Next.js answers a link to this same page with other search params by scrolling the page to the top once the new content is in.
  // On iPhones and iPads the column is scrolled instead, at the same moment. A link back to the address the page was opened at does
  // not scroll, as on a computer.
  const toTop = (event: MouseEvent, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const to = new URL(href, location.href), target = to.pathname + to.search;
    if (to.pathname !== location.pathname || target === opened.current) return;
    opened.current = target;
    fromTop.current = target;
  };
  const workspace: Group = { id: "workspace", label: s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র"), openClass, items: [
    classes ?? { id: "classes", label: role === "admin" ? s("All classes", "সব ক্লাস") : s("My classes", "আমার ক্লাস"), href: "/teach" },
  ], more: [{ id: "family", label: s("Home learners", "বাড়ির শিক্ষার্থী"), href: "/family" }] };
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
    ? <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined} onClick={(event) => { setOpen(false); toTop(event, item.href!); }}>{item.label}</Link>
    : <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onClick={() => { item.onClick?.(); setOpen(false); }}>{item.label}</button>;
  return <div className="portal-shell" lang={language}>
    <a className="skip-link" href="#portal-main">{s("Skip to content", "মূল অংশে যান")}</a>
    <aside className={`portal-sidebar ${open ? "is-open" : ""}`}>
      <Link className="portal-brand" href={home} onClick={(event) => toTop(event, home)}><span aria-hidden="true">বা</span><strong>Bangla<br />Adventures</strong></Link>
      <p className="portal-role">{s(`${roleLabels[role][0]} portal`, `${roleLabels[role][1]} পোর্টাল`)}</p>
      <nav ref={nav} id="portal-navigation" aria-label={s("Portal navigation", "পোর্টালের মেনু")}>
        {groups.map((group) => group.label
          ? <div key={group.id} className="portal-nav-group" role="group" aria-labelledby={`portal-nav-${group.id}`}>
            <p className="portal-nav-heading" id={`portal-nav-${group.id}`}>{group.label}</p>
            {group.items.map(link)}
            {group.openClass && <div className="portal-nav-class" role="group" aria-labelledby="portal-nav-open-class">
              <p className="portal-nav-class-name"><small>{s("Current class", "বর্তমান ক্লাস")}</small><span id="portal-nav-open-class" title={group.openClass.name}>{group.openClass.name}</span></p>
              {group.openClass.sections.map(link)}
            </div>}
            {group.more?.map(link)}
          </div>
          : <div key={group.id} className="portal-nav-group">{group.items.map(link)}</div>)}
        <div className="portal-nav-group portal-nav-end">{end.map(link)}</div>
      </nav>
      <a className="portal-signout" href={role === "student" ? "/api/student/sign-out?returnTo=%2Fstudent" : "/api/auth/sign-out?returnTo=%2Fgrown-ups"}>{s("Sign out", "সাইন আউট")}</a>
    </aside>
    <div ref={column} className="portal-workspace">
      <header className="portal-topbar"><button ref={menu} className="portal-menu" type="button" aria-expanded={open} aria-controls="portal-navigation" onClick={() => setOpen(!open)}>{s("Menu", "মেনু")}</button><span>{s("Welcome", "স্বাগতম")}, <strong>{name}</strong></span><button lang={language === "bn" ? "en" : "bn"} className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
      <div id="portal-main" className="portal-content" inert={open || undefined}><PortalLanguage value={language}>{children}</PortalLanguage></div>
    </div>
  </div>;
}
