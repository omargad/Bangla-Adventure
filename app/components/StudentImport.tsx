"use client";
import { useEffect, useState } from "react";
import { localMessage, localNumber, type Language } from "@/lib/use-language";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, signInSheetCsv, STUDENT_IMPORT_TEMPLATE, type SignInSheetRow, type StudentImportIssue } from "@/lib/student-import";

const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(STUDENT_IMPORT_TEMPLATE)}`;
type ExistingAllocation = { displayName: string; username: string; alreadyInClass: boolean };

/** Asked before anything would discard temporary passwords that are still on screen. */
export function confirmDiscardPasswords(language: Language = "en"): boolean {
  return window.confirm(language === "bn"
    ? "স্ক্রিনের অস্থায়ী পাসওয়ার্ডগুলো বাদ দেবেন? আগে সাইন-ইন শিট নামান বা প্রিন্ট করুন — এগুলো আর দেখানো যাবে না।"
    : "Discard the temporary passwords on screen? Download or print the sign-in sheet first — they cannot be shown again.");
}

/**
 * While temporary passwords are on screen (they exist nowhere else), warn before a reload, closing
 * the tab or following an in-app link loses them, and report it through onPasswordsChange.
 */
export function usePasswordGuard(showing: boolean, language: Language, onPasswordsChange?: (shown: boolean) => void) {
  useEffect(() => {
    onPasswordsChange?.(showing);
    if (!showing) return;
    let leaving = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    // In-app links change the page without unloading it, so ask when one is clicked.
    const followLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (confirmDiscardPasswords(language)) leaving = true;
      else { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followLink, true);
    return () => {
      onPasswordsChange?.(false);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followLink, true);
    };
  }, [showing, language, onPasswordsChange]);
}

/** The rows an upload was refused for, each in the page language. */
export function ImportRowErrors({ errors, language }: { errors: StudentImportIssue[]; language: Language }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  if (!errors.length) return null;
  return <ul className="student-import-errors" aria-label={s("Rows to fix", "যে সারিগুলো ঠিক করতে হবে")}>
    {errors.map((item, index) => <li key={`${item.line}-${index}`}>{item.line > 0 && <strong>{s("Line", "লাইন")} {localNumber(item.line, language)}: </strong>}{language === "bn" && item.messageBn ? item.messageBn : item.message}</li>)}
  </ul>;
}

/** Save a CSV built in the browser; the BOM lets spreadsheet apps open Bangla names correctly. */
export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * onPasswordsChange reports whether temporary passwords are on screen, so a parent that would
 * unmount this panel (closing or switching the class) can ask with confirmDiscardPasswords first.
 */
export default function StudentImport({ classId, language = "en", onImported, onPasswordsChange }: { classId: string; language?: Language; onImported?: () => void; onPasswordsChange?: (shown: boolean) => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<StudentImportIssue[]>([]);
  // Offered once the server reports rows that would give a name that already has an account a second one.
  const [sameNames, setSameNames] = useState(false);
  const [createSameNames, setCreateSameNames] = useState(false);
  const [result, setResult] = useState<{ created: SignInSheetRow[]; existing: ExistingAllocation[] } | null>(null);
  const [signInUrl, setSignInUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const created = result && result.created.length > 0 ? result.created : null;
  usePasswordGuard(created !== null, language, onPasswordsChange);
  function chooseFile(next: File | null) {
    setFile(next); setError(""); setRowErrors([]); setSameNames(false); setCreateSameNames(false);
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) { setError(s("Choose a CSV file first.", "আগে একটি CSV ফাইল বেছে নিন।")); return; }
    if (file.size > MAX_IMPORT_BYTES) { setError(s(`The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it into smaller files.`, `ফাইলটি ${number(MAX_IMPORT_BYTES / 1024)} KB-এর বড়। ছোট ছোট ফাইলে ভাগ করুন।`)); return; }
    // A new upload replaces the sheet on screen.
    if (created && !confirmDiscardPasswords(language)) return;
    setBusy(true); setError(""); setRowErrors([]); setResult(null);
    const fallback: [string, string] = ["The students could not be imported. Please try again.", "শিক্ষার্থীদের যোগ করা যায়নি। আবার চেষ্টা করুন।"];
    try {
      const response = await fetch(`/api/classes/${classId}/students/import`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: await file.text(), createSameNames: sameNames && createSameNames }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (Array.isArray(data.errors)) setRowErrors(data.errors);
        if (data.sameNames) setSameNames(true);
        setError(localMessage(data, language, fallback));
        return;
      }
      setResult({ created: data.created ?? [], existing: data.existing ?? [] }); setSignInUrl(`${window.location.origin}/student`);
      setFile(null); setInputKey((key) => key + 1); setSameNames(false); setCreateSameNames(false);
      onImported?.();
    } catch { setError(s(...fallback)); }
    finally { setBusy(false); }
  }
  function hidePasswords() {
    if (window.confirm(s("Hide the temporary passwords? They cannot be shown again.", "অস্থায়ী পাসওয়ার্ডগুলো লুকাবেন? এগুলো আর দেখানো যাবে না।"))) setResult(null);
  }
  const existing = result?.existing ?? [];
  const added = existing.filter((row) => !row.alreadyInClass).length;
  return <section className="teach-panel" aria-label={s("Add students from a CSV file", "CSV ফাইল থেকে শিক্ষার্থী যোগ করুন")}>
    <h2>{s("Add students from a CSV file", "CSV ফাইল থেকে শিক্ষার্থী যোগ করুন")}</h2>
    <p>{s(`Use a header row with a "name" column and, optionally, a "username" column — up to ${MAX_IMPORT_ROWS} students per file. A row with the username of a student who already has an account adds that student to this class. Every other row gets a new account in this class and a temporary password; blank usernames are generated from the name.`, `প্রথম সারিতে "name" কলাম এবং চাইলে "username" কলাম রাখুন — প্রতি ফাইলে সর্বোচ্চ ${number(MAX_IMPORT_ROWS)} জন। যে শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে, তার ব্যবহারকারীর নাম দিলে তাকে এই ক্লাসে যোগ করা হবে। বাকি প্রত্যেকে এই ক্লাসে একটি নতুন অ্যাকাউন্ট ও অস্থায়ী পাসওয়ার্ড পাবে; ব্যবহারকারীর নাম ফাঁকা থাকলে নাম থেকে তৈরি হবে।`)}</p>
    <p>{s("Temporary passwords are shown only once. Students must choose their own password the first time they sign in.", "অস্থায়ী পাসওয়ার্ড কেবল একবারই দেখানো হয়। প্রথমবার সাইন ইন করার সময় শিক্ষার্থীরা নিজের পাসওয়ার্ড বেছে নেবে।")}</p>
    <a className="outline-button" href={templateHref} download="student-list-template.csv">{s("Download the CSV template", "CSV টেমপ্লেট নামান")}</a>
    <form className="teach-inline-form" onSubmit={upload}>
      <label>{s("Student list (CSV file)", "শিক্ষার্থীর তালিকা (CSV ফাইল)")}<input key={inputKey} type="file" accept=".csv,text/csv" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} /></label>
      <button className="primary-button" disabled={busy || !file}>{busy ? s("Creating accounts…", "অ্যাকাউন্ট তৈরি হচ্ছে…") : s("Upload and create accounts", "আপলোড করে অ্যাকাউন্ট তৈরি করুন")}</button>
    </form>
    {error && <div role="alert" className="auth-error"><p>{error}</p><ImportRowErrors errors={rowErrors} language={language} /></div>}
    {sameNames && <label className="import-confirm"><input type="checkbox" checked={createSameNames} onChange={(event) => setCreateSameNames(event.target.checked)} />{s("Create new accounts for matching names too", "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন")}<small>{s("Only tick this if those rows are different children. To add the existing students instead, write their exact usernames in the file.", "সারিগুলো অন্য শিশুদের হলে তবেই টিক দিন। আগের শিক্ষার্থীদের যোগ করতে চাইলে ফাইলে তাদের ঠিক ব্যবহারকারীর নামটি লিখুন।")}</small></label>}
    {result && <div className="student-import-result">
      <p role="status" className="teach-message">{[
        result.created.length > 0 || existing.length === 0 ? s(`${result.created.length} student account${result.created.length === 1 ? "" : "s"} created and added to this class.`, `${number(result.created.length)}টি শিক্ষার্থী অ্যাকাউন্ট তৈরি হয়ে এই ক্লাসে যোগ হয়েছে।`) : "",
        existing.length > 0 ? s(`${added} student${added === 1 ? "" : "s"} who already had an account added to this class${existing.length > added ? `; ${existing.length - added} ${existing.length - added === 1 ? "was" : "were"} already in it` : ""}.`, `আগে থেকে অ্যাকাউন্ট থাকা ${number(added)} জন শিক্ষার্থী এই ক্লাসে যোগ হয়েছে${existing.length > added ? `; ${number(existing.length - added)} জন আগেই ছিল` : ""}।`) : "",
      ].filter(Boolean).join(" ")}</p>
      {existing.length > 0 && <div className="portal-table">
        <h3>{s("Already had an account", "আগেই অ্যাকাউন্ট ছিল")}</h3>
        <p>{s("These students keep their own password.", "এই শিক্ষার্থীদের পাসওয়ার্ড আগের মতোই থাকবে।")}</p>
        <table><thead><tr><th>{s("Name", "নাম")}</th><th>{s("Username", "ব্যবহারকারীর নাম")}</th><th>{s("Class", "ক্লাস")}</th></tr></thead>
          <tbody>{existing.map((row) => <tr key={row.username}><td>{row.displayName}</td><td><code>{row.username}</code></td><td>{row.alreadyInClass ? s("Already in this class", "আগেই এই ক্লাসে ছিল") : s("Added", "যোগ হয়েছে")}</td></tr>)}</tbody></table>
      </div>}
      {created && <>
        <p><strong>{s("Save these passwords now — they will not be shown again.", "এখনই পাসওয়ার্ডগুলো সংরক্ষণ করুন — এগুলো আর দেখানো হবে না।")}</strong> {s("Give each student their username and temporary password. At first sign-in they will be asked to choose their own password.", "প্রত্যেক শিক্ষার্থীকে তার ব্যবহারকারীর নাম ও অস্থায়ী পাসওয়ার্ড দিন। প্রথমবার সাইন ইন করলে তাকে নিজের পাসওয়ার্ড বেছে নিতে বলা হবে।")}</p>
        <div className="student-import-actions">
          <button type="button" className="primary-button" onClick={() => downloadCsv(signInSheetCsv(created, language), "student-sign-in-sheet.csv")}>{s("Download sign-in sheet", "সাইন-ইন শিট নামান")}</button>
          <button type="button" className="outline-button" onClick={() => window.print()}>{s("Print sign-in sheet", "সাইন-ইন শিট প্রিন্ট করুন")}</button>
          <button type="button" className="text-button" onClick={hidePasswords}>{s("Hide passwords", "পাসওয়ার্ড লুকান")}</button>
        </div>
        <div className="student-import-sheet portal-table">
          <h3>{s("Student sign-in sheet", "শিক্ষার্থীর সাইন-ইন শিট")}</h3>
          <p>{s("Sign in at", "সাইন ইন করো")} <strong>{signInUrl}</strong> {s("with your username and temporary password, then choose your own password.", "তোমার ব্যবহারকারীর নাম ও অস্থায়ী পাসওয়ার্ড দিয়ে, তারপর নিজের পাসওয়ার্ড বেছে নাও।")}</p>
          <table><thead><tr><th>{s("Name", "নাম")}</th><th>{s("Username", "ব্যবহারকারীর নাম")}</th><th>{s("Temporary password", "অস্থায়ী পাসওয়ার্ড")}</th></tr></thead>
            <tbody>{created.map((account) => <tr key={account.username}><td>{account.displayName}</td><td><code>{account.username}</code></td><td><code>{account.temporaryPassword}</code></td></tr>)}</tbody></table>
        </div>
      </>}
    </div>}
  </section>;
}
