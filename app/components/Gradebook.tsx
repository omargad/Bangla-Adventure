"use client";
import { useId, useState } from "react";
import { filterGradebookRows, type Gradebook as GradebookData } from "@/lib/gradebook";
import type { AttendanceSummary } from "@/lib/attendance";
import { localNumber, type Language } from "@/lib/use-language";
import styles from "./Gradebook.module.css";

/** "attended 3 of 5" for a gradebook or roster cell, or "—" before any session is recorded. */
export function attendanceText(summary: AttendanceSummary | null | undefined, language: Language): string {
  if (!summary || summary.recorded === 0) return "—";
  const number = (value: number) => localNumber(value, language);
  return language === "bn" ? `${number(summary.recorded)}টির মধ্যে ${number(summary.attended)}টি` : `${summary.attended} of ${summary.recorded}`;
}

/**
 * Put each student's summary before the activity columns. On narrow screens the same summary
 * lives in the sticky student cell, so it stays visible while teachers scroll through activities.
 */
export default function Gradebook({ gradebook, language }: { gradebook: GradebookData; language: Language }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const [query, setQuery] = useState("");
  const scrollHelpId = useId();
  const rows = filterGradebookRows(gradebook.rows, query);
  const activityCount = gradebook.activities.length;
  if (!gradebook.rows.length) return <p className="teach-empty">{s("No students in this class yet. Add them in the Students section.", "এই ক্লাসে এখনও কোনো শিক্ষার্থী নেই। শিক্ষার্থী অংশে তাদের যোগ করুন।")}</p>;
  return <>
    <label className="gradebook-search">{s("Find a student", "শিক্ষার্থী খুঁজুন")}<input type="search" value={query} maxLength={60} autoComplete="off" placeholder={s("Name or username", "নাম বা ব্যবহারকারীর নাম")} onChange={(event) => setQuery(event.target.value)} /></label>
    <p className="gradebook-legend">{s("— means not submitted yet. The average counts submitted work only.", "— মানে এখনও জমা দেওয়া হয়নি। গড় শুধু জমা দেওয়া কাজ থেকে হিসাব করা হয়।")}</p>
    {rows.length === 0 ? <p className="teach-empty">{s("No student matches this search.", "এই খোঁজে কোনো শিক্ষার্থী মেলেনি।")}</p>
      : <>
      {activityCount > 0 && <p className={styles.scrollHelp} id={scrollHelpId}>{s("Scroll across for activity scores. On a keyboard, focus the gradebook and use the arrow keys.", "কার্যক্রমের স্কোর দেখতে পাশে স্ক্রল করুন। কিবোর্ডে গ্রেডবুকে ফোকাস করে তীরচিহ্নের কী ব্যবহার করুন।")}</p>}
      <div className={styles.scroll} role="region" aria-label={s("Gradebook", "গ্রেডবুক")} aria-describedby={activityCount > 0 ? scrollHelpId : undefined} tabIndex={0}>
        <table className={styles.table}>
          <caption className="sr-only">{s("Scores by student and activity", "শিক্ষার্থী ও কার্যক্রম অনুযায়ী স্কোর")}</caption>
          <thead><tr>
            <th scope="col">{s("Student", "শিক্ষার্থী")}</th>
            <th scope="col" className={styles.summaryColumn}>{s("Done", "সম্পন্ন")}</th><th scope="col" className={styles.summaryColumn}>{s("Average", "গড়")}</th><th scope="col" className={styles.summaryColumn}>{s("Attendance", "উপস্থিতি")}</th>
            {gradebook.activities.map((activity) => <th scope="col" key={activity.id}><span className={styles.activityTitle}>{activity.title}</span></th>)}
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.student.id}>
            <th scope="row">{row.student.displayName}{row.student.username && <small>{row.student.username}</small>}
              <dl className={styles.mobileSummary}>
                <div><dt>{s("Done", "সম্পন্ন")}</dt><dd>{number(row.done)}/{number(activityCount)}</dd></div>
                <div><dt>{s("Average", "গড়")}</dt><dd>{row.averagePercent === null ? "—" : `${number(row.averagePercent)}%`}</dd></div>
                <div><dt>{s("Attendance", "উপস্থিতি")}</dt><dd>{attendanceText(row.attendance, language)}</dd></div>
              </dl>
            </th>
            <td className={styles.summaryColumn}>{number(row.done)}/{number(activityCount)}</td>
            <td className={styles.summaryColumn}>{row.averagePercent === null ? "—" : `${number(row.averagePercent)}%`}</td>
            <td className={styles.summaryColumn}>{attendanceText(row.attendance, language)}</td>
            {row.cells.map((cell, index) => cell
              ? <td key={gradebook.activities[index].id}>{number(cell.score)}/{number(cell.total)}</td>
              : <td key={gradebook.activities[index].id} className={`gradebook-missing ${styles.missing}`}><span aria-hidden="true">—</span><span className="sr-only">{s("Not submitted", "জমা হয়নি")}</span></td>)}
          </tr>)}</tbody>
        </table>
      </div></>}
  </>;
}
