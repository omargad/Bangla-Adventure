"use client";
import { useState } from "react";
import { filterGradebookRows, type Gradebook as GradebookData } from "@/lib/gradebook";
import type { AttendanceSummary } from "@/lib/attendance";
import { localNumber, type Language } from "@/lib/use-language";

/** "attended 3 of 5" for a gradebook or roster cell, or "—" before any session is recorded. */
export function attendanceText(summary: AttendanceSummary | null | undefined, language: Language): string {
  if (!summary || summary.recorded === 0) return "—";
  const number = (value: number) => localNumber(value, language);
  return language === "bn" ? `${number(summary.recorded)}টির মধ্যে ${number(summary.attended)}টি` : `${summary.attended} of ${summary.recorded}`;
}

/**
 * A class gradebook: one row per student (A–Z, searchable by name or username), one column per
 * activity, then activities done, the average over submitted work and attendance. The header row and
 * the student column stay in view while the table scrolls, so it stays readable with many students
 * and many activities, also on a phone.
 */
export default function Gradebook({ gradebook, language }: { gradebook: GradebookData; language: Language }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const [query, setQuery] = useState("");
  const rows = filterGradebookRows(gradebook.rows, query);
  const activityCount = gradebook.activities.length;
  if (!gradebook.rows.length) return <p className="teach-empty">{s("No students in this class yet. Add them in the Students section.", "এই ক্লাসে এখনও কোনো শিক্ষার্থী নেই। শিক্ষার্থী অংশে তাদের যোগ করুন।")}</p>;
  return <>
    <label className="gradebook-search">{s("Find a student", "শিক্ষার্থী খুঁজুন")}<input type="search" value={query} maxLength={60} autoComplete="off" placeholder={s("Name or username", "নাম বা ব্যবহারকারীর নাম")} onChange={(event) => setQuery(event.target.value)} /></label>
    <p className="gradebook-legend">{s("— means not submitted yet. The average counts submitted work only.", "— মানে এখনও জমা দেওয়া হয়নি। গড় শুধু জমা দেওয়া কাজ থেকে হিসাব করা হয়।")}</p>
    {rows.length === 0 ? <p className="teach-empty">{s("No student matches this search.", "এই খোঁজে কোনো শিক্ষার্থী মেলেনি।")}</p>
      : <div className="gradebook-scroll" role="region" aria-label={s("Gradebook", "গ্রেডবুক")} tabIndex={0}>
        <table className="gradebook-table">
          <caption className="sr-only">{s("Scores by student and activity", "শিক্ষার্থী ও কার্যক্রম অনুযায়ী স্কোর")}</caption>
          <thead><tr>
            <th scope="col">{s("Student", "শিক্ষার্থী")}</th>
            {gradebook.activities.map((activity) => <th scope="col" key={activity.id} title={activity.title}><span className="gradebook-title">{activity.title}</span></th>)}
            <th scope="col">{s("Done", "সম্পন্ন")}</th><th scope="col">{s("Average", "গড়")}</th><th scope="col">{s("Attendance", "উপস্থিতি")}</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.student.id}>
            <th scope="row">{row.student.displayName}{row.student.username && <small>{row.student.username}</small>}</th>
            {row.cells.map((cell, index) => cell
              ? <td key={gradebook.activities[index].id}>{number(cell.score)}/{number(cell.total)}</td>
              : <td key={gradebook.activities[index].id} className="gradebook-missing"><span aria-hidden="true">—</span><span className="sr-only">{s("Not submitted", "জমা হয়নি")}</span></td>)}
            <td>{number(row.done)}/{number(activityCount)}</td>
            <td>{row.averagePercent === null ? "—" : `${number(row.averagePercent)}%`}</td>
            <td>{attendanceText(row.attendance, language)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </>;
}
