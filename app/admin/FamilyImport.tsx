"use client";
import { useEffect, useState } from "react";
import { confirmDiscardPasswords, downloadCsv, ImportRowErrors, usePasswordGuard } from "@/app/components/StudentImport";
import { FAMILY_IMPORT_TEMPLATE, familySheetCsv, groupFamilies, type FamilySheetRow } from "@/lib/family-import";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ImportIssue } from "@/lib/student-import";
import { localMessage, localNumber, type Language } from "@/lib/use-language";

const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(FAMILY_IMPORT_TEMPLATE)}`;

/**
 * The administrator's "Import families (CSV)" panel: one upload creates each student, creates or reuses
 * their parent's account, links them and can put the students in a class. The result is a printable
 * sign-in sheet per family, shown once; nothing is e-mailed. `beforeUpload` lets the page clear other
 * sign-in details first, so only one sheet is ever on screen.
 */
export default function FamilyImport({ language, onImported, onPasswordsChange, beforeUpload, onClose }: { language: Language; onImported?: () => void; onPasswordsChange?: (shown: boolean) => void; beforeUpload?: () => boolean; onClose?: () => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  // Both languages at once on the printed sheet, the page language first.
  const both = (en: string, bn: string) => language === "bn" ? `${bn} / ${en}` : `${en} / ${bn}`;
  const number = (value: number) => localNumber(value, language);
  const [classes, setClasses] = useState<{ id: string; name: string; teacherName?: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<ImportIssue[]>([]);
  // Offered once the server reports rows that would give a name that already has an account a second one.
  const [sameNames, setSameNames] = useState(false);
  const [createSameNames, setCreateSameNames] = useState(false);
  const [result, setResult] = useState<{ families: FamilySheetRow[]; className: string | null } | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  usePasswordGuard(result !== null && result.families.some((row) => row.temporaryPassword !== null || row.parentTemporaryPassword !== null), language, onPasswordsChange);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/classes?scope=all", { signal: controller.signal }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.ok) setClasses(data.classes);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) { setError(s("Choose a CSV file first.", "আগে একটি CSV ফাইল বেছে নিন।")); return; }
    if (file.size > MAX_IMPORT_BYTES) { setError(s(`The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it into smaller files.`, `ফাইলটি ${number(MAX_IMPORT_BYTES / 1024)} KB-এর বড়। ছোট ছোট ফাইলে ভাগ করুন।`)); return; }
    // A new upload replaces the sheet on screen.
    if (result && !confirmDiscardPasswords(language)) return;
    if (beforeUpload && !beforeUpload()) return;
    setBusy(true); setError(""); setRowErrors([]); setResult(null);
    const fallback: [string, string] = ["The families could not be imported. Please try again.", "পরিবারগুলো যোগ করা যায়নি। আবার চেষ্টা করুন।"];
    try {
      const response = await fetch("/api/admin/families/import", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: await file.text(), classId: classId || null, createSameNames: sameNames && createSameNames }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (Array.isArray(data.errors)) setRowErrors(data.errors);
        if (data.sameNames) setSameNames(true);
        setError(localMessage(data, language, fallback));
        return;
      }
      setResult({ families: data.families, className: data.className }); setOrigin(window.location.origin);
      setFile(null); setInputKey((key) => key + 1); setSameNames(false); setCreateSameNames(false);
      onImported?.();
    } catch { setError(s(...fallback)); }
    finally { setBusy(false); }
  }
  function hidePasswords() {
    if (window.confirm(s("Hide the temporary passwords? They cannot be shown again.", "অস্থায়ী পাসওয়ার্ডগুলো লুকাবেন? এগুলো আর দেখানো যাবে না।"))) setResult(null);
  }
  const groups = result ? groupFamilies(result.families) : [];
  const newParents = groups.filter((group) => group.parentTemporaryPassword !== null).length;
  const reused = groups.length - newParents;
  // A child with two parents is listed in both families: count each student once.
  const students = new Set(result?.families.filter((row) => row.temporaryPassword !== null).map((row) => row.username)).size;
  const linkedStudents = new Set(result?.families.filter((row) => row.temporaryPassword === null).map((row) => row.username)).size;
  return <section className="teach-panel" aria-labelledby="family-import-title">
    <div className="family-import-heading"><h2 id="family-import-title">{s("Import families (CSV)", "পরিবার যোগ করুন (CSV)")}</h2>{onClose && <button type="button" className="text-button" onClick={onClose}>{s("Close", "বন্ধ করুন")}</button>}</div>
    <p>{s(`Upload one CSV file with the columns "student name", "parent name" and "parent email" — up to ${MAX_IMPORT_ROWS} students per file. Each student gets an account and is linked to their parent. Brothers and sisters share one parent account: use the same parent e-mail on each of their rows. An optional "student username" column chooses the username; otherwise it is made from the name. The username of a student who already has an account links that student instead, and a child with two parents gets one row for each parent with the same username.`, `"student name", "parent name" ও "parent email" কলামসহ একটি CSV ফাইল আপলোড করুন — প্রতি ফাইলে সর্বোচ্চ ${number(MAX_IMPORT_ROWS)} জন শিক্ষার্থী। প্রত্যেক শিক্ষার্থী একটি অ্যাকাউন্ট পাবে এবং তার অভিভাবকের সঙ্গে যুক্ত হবে। ভাই-বোনেরা একটি অভিভাবক অ্যাকাউন্টই পাবে: তাদের প্রতিটি সারিতে একই অভিভাবকের ইমেইল দিন। চাইলে "student username" কলামে ব্যবহারকারীর নাম দিতে পারেন; না দিলে নাম থেকে তৈরি হবে। যে শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে, তার ব্যবহারকারীর নাম দিলে নতুন অ্যাকাউন্ট না খুলে তাকেই যুক্ত করা হবে; কোনো শিশুর দুজন অভিভাবক থাকলে প্রত্যেক অভিভাবকের জন্য একটি করে সারি দিন, দুই সারিতে একই ব্যবহারকারীর নাম লিখে।`)}</p>
    <p>{s("A parent e-mail that already belongs to an approved parent account with the same name is linked to that account, and its password stays the same. A child already linked to that parent is not added again, and a name that already has a student account needs your confirmation, so uploading a list twice never creates second accounts. New parents and every student get a temporary password, shown only once on a sheet you can print, and must choose their own password at first sign-in. Nothing is sent by e-mail.", "যে অভিভাবকের ইমেইলে একই নামের অনুমোদিত অভিভাবক অ্যাকাউন্ট আগে থেকেই আছে, শিক্ষার্থীকে সেই অ্যাকাউন্টের সঙ্গে যুক্ত করা হবে, পাসওয়ার্ড বদলাবে না। ওই অভিভাবকের সঙ্গে আগে থেকে যুক্ত শিশুকে আবার যোগ করা হয় না, আর যে নামে আগেই শিক্ষার্থী অ্যাকাউন্ট আছে সেই নামে নতুন অ্যাকাউন্ট খুলতে আপনার সম্মতি লাগে, তাই একই তালিকা দুবার আপলোড করলেও দ্বিতীয় অ্যাকাউন্ট তৈরি হয় না। নতুন অভিভাবক ও প্রত্যেক শিক্ষার্থী একটি অস্থায়ী পাসওয়ার্ড পাবেন, যা একবারই প্রিন্টযোগ্য শিটে দেখানো হবে; প্রথমবার সাইন ইন করে নিজের পাসওয়ার্ড বেছে নিতে হবে। কোনো ইমেইল পাঠানো হয় না।")}</p>
    <a className="outline-button" href={templateHref} download="family-import-template.csv">{s("Download the family CSV template", "পরিবারের CSV টেমপ্লেট নামান")}</a>
    <form className="management-form family-import-form" onSubmit={upload}>
      <label>{s("Family list (CSV file)", "পরিবারের তালিকা (CSV ফাইল)")}<input key={inputKey} type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); setRowErrors([]); setSameNames(false); setCreateSameNames(false); }} /></label>
      <label>{s("Also add the students to a class (optional)", "শিক্ষার্থীদের একটি ক্লাসেও যোগ করুন (ঐচ্ছিক)")}<select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">{s("No class for now", "এখন কোনো ক্লাস নয়")}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.teacherName ? `${item.name} · ${item.teacherName}` : item.name}</option>)}</select></label>
      <button className="primary-button" disabled={busy || !file}>{busy ? s("Creating accounts…", "অ্যাকাউন্ট তৈরি হচ্ছে…") : s("Upload and create accounts", "আপলোড করে অ্যাকাউন্ট তৈরি করুন")}</button>
    </form>
    {error && <div role="alert" className="auth-error"><p>{error}</p><ImportRowErrors errors={rowErrors} language={language} /></div>}
    {sameNames && <label className="import-confirm"><input type="checkbox" checked={createSameNames} onChange={(event) => setCreateSameNames(event.target.checked)} />{s("Create new accounts for matching names too", "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন")}<small>{s("Only tick this if those rows are different children. To link the existing students instead, write their exact usernames in the \"student username\" column.", "সারিগুলো অন্য শিশুদের হলে তবেই টিক দিন। আগের শিক্ষার্থীদের যুক্ত করতে চাইলে \"student username\" কলামে তাদের ঠিক ব্যবহারকারীর নামটি লিখুন।")}</small></label>}
    {result && <div className="student-import-result">
      <p role="status" className="teach-message">{s(
        `${students} student account${students === 1 ? "" : "s"} and ${newParents} new parent account${newParents === 1 ? "" : "s"} created.${linkedStudents ? ` ${linkedStudents} student${linkedStudents === 1 ? " who already had an account was" : "s who already had an account were"} linked.` : ""}${reused ? ` ${reused} existing parent account${reused === 1 ? " was" : "s were"} linked.` : ""}${result.className ? ` The students were added to ${result.className}.` : ""}`,
        `${number(students)}টি শিক্ষার্থী অ্যাকাউন্ট ও ${number(newParents)}টি নতুন অভিভাবক অ্যাকাউন্ট তৈরি হয়েছে।${linkedStudents ? ` আগে থেকে অ্যাকাউন্ট থাকা ${number(linkedStudents)} জন শিক্ষার্থী যুক্ত হয়েছে।` : ""}${reused ? ` আগের ${number(reused)}টি অভিভাবক অ্যাকাউন্ট যুক্ত হয়েছে।` : ""}${result.className ? ` শিক্ষার্থীরা ${result.className} ক্লাসে যোগ হয়েছে।` : ""}`)}</p>
      <p><strong>{s("Save these passwords now — they will not be shown again.", "এখনই পাসওয়ার্ডগুলো সংরক্ষণ করুন — এগুলো আর দেখানো হবে না।")}</strong> {s("Each family prints on a page of its own: give each family only their page, privately.", "প্রত্যেক পরিবারের তথ্য আলাদা পাতায় প্রিন্ট হয়: প্রত্যেক পরিবারকে শুধু তাদের পাতাটি ব্যক্তিগতভাবে দিন।")}</p>
      <div className="student-import-actions">
        <button type="button" className="primary-button" onClick={() => downloadCsv(familySheetCsv(result.families, language), "family-sign-in-sheet.csv")}>{s("Download sign-in sheet", "সাইন-ইন শিট নামান")}</button>
        <button type="button" className="outline-button" onClick={() => window.print()}>{s("Print sign-in sheet", "সাইন-ইন শিট প্রিন্ট করুন")}</button>
        <button type="button" className="text-button" onClick={hidePasswords}>{s("Hide passwords", "পাসওয়ার্ড লুকান")}</button>
      </div>
      <div className="student-import-sheet family-sheet">
        <h3>{both("Bangla Adventures family sign-in sheet", "Bangla Adventures পরিবারের সাইন-ইন শিট")}</h3>
        {groups.map((group) => <section key={group.parentEmail} className="family-sheet-group portal-table" aria-label={s(`Family of ${group.parentName}`, `${group.parentName}-এর পরিবার`)}>
          <p className="family-sheet-print-title" aria-hidden="true">{both("Bangla Adventures family sign-in sheet", "Bangla Adventures পরিবারের সাইন-ইন শিট")}</p>
          <h4>{both("Parent", "অভিভাবক")}: {group.parentName}</h4>
          <dl>
            <div><dt>{both("E-mail", "ইমেইল")}</dt><dd><code>{group.parentEmail}</code></dd></div>
            <div><dt>{both("Temporary password", "অস্থায়ী পাসওয়ার্ড")}</dt><dd>{group.parentTemporaryPassword ? <code>{group.parentTemporaryPassword}</code> : both("Existing account, password unchanged", "আগের অ্যাকাউন্ট, পাসওয়ার্ড বদলায়নি")}</dd></div>
            <div><dt>{both("Sign in at", "সাইন ইনের ঠিকানা")}</dt><dd>{origin}/grown-ups</dd></div>
          </dl>
          <table><thead><tr><th>{both("Student", "শিক্ষার্থী")}</th><th>{both("Username", "ব্যবহারকারীর নাম")}</th><th>{both("Temporary password", "অস্থায়ী পাসওয়ার্ড")}</th></tr></thead>
            <tbody>{group.children.map((child) => <tr key={child.username}><td>{child.studentName}</td><td><code>{child.username}</code></td><td>{child.temporaryPassword ? <code>{child.temporaryPassword}</code> : both("Existing account, password unchanged", "আগের অ্যাকাউন্ট, পাসওয়ার্ড বদলায়নি")}</td></tr>)}</tbody></table>
          <p>{both(`Students sign in at ${origin}/student with their username. Everyone chooses their own password at the first sign-in.`, `শিক্ষার্থীরা ${origin}/student ঠিকানায় ব্যবহারকারীর নাম দিয়ে সাইন ইন করবে। প্রথমবার সাইন ইন করে সবাই নিজের পাসওয়ার্ড বেছে নেবেন।`)}</p>
        </section>)}
      </div>
    </div>}
  </section>;
}
