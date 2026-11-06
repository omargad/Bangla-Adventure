import type { AttendanceSummary } from "./attendance";

/**
 * A class gradebook: one row per student now in the class, A–Z, and one column per published
 * activity, newest first like the activity list. Shared by the teacher workspace, the administrator's
 * results page and the CSV export, so it stays free of database and Node-only imports.
 *
 * Only activities students can see count: those an administrator approved (open or closed). One
 * waiting for approval or sent back for changes gets no column and is not in anyone's Done total,
 * which then matches the student's own "Activities complete"; `unpublished` says how many were left out.
 */

export type GradebookSubmission = { id: string; score: number; total: number; submittedAt: string };
export type GradebookStudent = { id: string; displayName: string; username?: string | null; attendance?: AttendanceSummary | null };
export type GradebookActivity = {
  id: string; title: string; createdAt: string;
  /** "approved" is published to students; anything else is left out. Omitted, the activity counts. */
  approvalStatus?: string;
  submissions: Array<GradebookSubmission & { studentId: string }>;
};
export type GradebookRow = {
  student: { id: string; displayName: string; username: string | null };
  /** One per activity column; null when the student has not submitted it. */
  cells: Array<GradebookSubmission | null>;
  done: number;
  /** Score-weighted over submitted work only; null before anything is submitted. */
  averagePercent: number | null;
  attendance: AttendanceSummary | null;
};
export type Gradebook = {
  activities: Array<{ id: string; title: string }>;
  rows: GradebookRow[];
  /** Activities in the class that students cannot see yet (waiting for approval or changes requested). */
  unpublished: number;
};

/** Whether students can see the activity, so it belongs in the gradebook. */
export const isPublishedActivity = (activity: { approvalStatus?: string }) => activity.approvalStatus === undefined || activity.approvalStatus === "approved";

const byStudentName = (a: GradebookStudent, b: GradebookStudent) =>
  a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base", numeric: true }) || (a.username ?? "").localeCompare(b.username ?? "") || a.id.localeCompare(b.id);

/** Build the gradebook. Unpublished activities, and submissions from anyone not in `students` (removed students), are left out. */
export function buildGradebook(students: GradebookStudent[], activities: GradebookActivity[]): Gradebook {
  const published = activities.filter(isPublishedActivity);
  const columns = [...published].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const rows = [...students].sort(byStudentName).map((student): GradebookRow => {
    const cells = columns.map((activity) => {
      const submission = activity.submissions.find((entry) => entry.studentId === student.id);
      return submission ? { id: submission.id, score: submission.score, total: submission.total, submittedAt: submission.submittedAt } : null;
    });
    const submitted = cells.filter((cell): cell is GradebookSubmission => cell !== null);
    const score = submitted.reduce((sum, cell) => sum + cell.score, 0);
    const total = submitted.reduce((sum, cell) => sum + cell.total, 0);
    return {
      student: { id: student.id, displayName: student.displayName, username: student.username ?? null },
      cells, done: submitted.length,
      averagePercent: total > 0 ? Math.round((score / total) * 100) : null,
      attendance: student.attendance ?? null,
    };
  });
  return { activities: columns.map(({ id, title }) => ({ id, title })), rows, unpublished: activities.length - published.length };
}

/** Rows whose student name or username contains the search, ignoring case. */
export function filterGradebookRows(rows: GradebookRow[], query: string): GradebookRow[] {
  const search = query.trim().toLocaleLowerCase();
  return search ? rows.filter(({ student }) => [student.displayName, student.username ?? ""].some((value) => value.toLocaleLowerCase().includes(search))) : rows;
}

/** "2 of 3" as plain text, which spreadsheets do not turn into a date as they would "2/3". */
const ofText = (count: number, total: number) => `${count} of ${total}`;

/**
 * The class grades CSV: one row per submission, A–Z by student, plus one row for each student who
 * has submitted nothing, so every student's activities done and attendance are in the file.
 */
export function gradebookCsvRows(className: string, gradebook: Gradebook): Array<Array<string | number>> {
  const header = ["Class", "Activity", "Student", "Score", "Total", "Percent", "Submitted At", "Done", "Attendance"];
  const rows = gradebook.rows.flatMap((row) => {
    const done = ofText(row.done, gradebook.activities.length);
    const attendance = row.attendance && row.attendance.recorded > 0 ? ofText(row.attendance.attended, row.attendance.recorded) : "";
    const submitted = row.cells.flatMap((cell, index) => cell ? [[className, gradebook.activities[index].title, row.student.displayName, cell.score, cell.total,
      cell.total > 0 ? Math.round((cell.score / cell.total) * 100) : 0, cell.submittedAt, done, attendance]] : []);
    return submitted.length ? submitted : [[className, "", row.student.displayName, "", "", "", "", done, attendance]];
  });
  return [header, ...rows];
}
