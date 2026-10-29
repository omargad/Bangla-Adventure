import assert from "node:assert/strict";
import test from "node:test";

const { attendancePercent, attendanceSessions, checkSessionDate, localDateKey, MAX_ATTENDANCE_MARKS, parseAttendanceMarks, summarizeAttendance } = await import("../lib/attendance.ts");
const now = new Date("2026-10-28T23:30:00Z");

test("session dates are real calendar dates up to tomorrow (UTC), for teachers ahead of the server", () => {
  assert.deepEqual(checkSessionDate("2026-10-28", now), { date: "2026-10-28" });
  assert.deepEqual(checkSessionDate("2026-10-29", now), { date: "2026-10-29" }, "tomorrow in UTC is today east of the server");
  assert.deepEqual(checkSessionDate("2024-02-29", now), { date: "2024-02-29" }, "a leap day");
  assert.match(checkSessionDate("2026-10-30", now).error, /future/);
  assert.match(checkSessionDate("2026-10-30", now).errorBn, /ভবিষ্যতের/);
  for (const value of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "1999-12-31", "28/10/2026", "2026-10-28T10:00", "", null, undefined, 20261028]) {
    const result = checkSessionDate(value, now);
    assert.ok("error" in result, String(value));
    assert.match(result.error, /date of the class/);
    assert.ok(result.errorBn);
  }
});

test("today is the local calendar date where the code runs", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDateKey(new Date(2026, 11, 31, 0, 1)), "2026-12-31");
  assert.match(localDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a save carries one present-or-absent mark per student", () => {
  assert.deepEqual(parseAttendanceMarks([{ studentId: "a", present: true }, { studentId: "b", present: false, extra: 1 }]), [{ studentId: "a", present: true }, { studentId: "b", present: false }]);
  for (const value of [
    [], null, undefined, "a", {}, [null], ["a"],
    [{ studentId: "a" }], [{ studentId: "a", present: "yes" }], [{ studentId: "", present: true }], [{ studentId: 7, present: true }],
    [{ studentId: "x".repeat(81), present: true }],
    [{ studentId: "a", present: true }, { studentId: "a", present: false }],
    Array.from({ length: MAX_ATTENDANCE_MARKS + 1 }, (_, index) => ({ studentId: `s${index}`, present: true })),
  ]) assert.equal(parseAttendanceMarks(value), null, JSON.stringify(value)?.slice(0, 60));
  assert.equal(parseAttendanceMarks(Array.from({ length: MAX_ATTENDANCE_MARKS }, (_, index) => ({ studentId: `s${index}`, present: true }))).length, MAX_ATTENDANCE_MARKS);
});

test("each student's attendance counts the sessions recorded for them", () => {
  const summaries = summarizeAttendance([
    { studentId: "maya", present: true }, { studentId: "maya", present: false }, { studentId: "maya", present: true },
    { studentId: "arif", present: false },
  ]);
  assert.deepEqual(summaries.get("maya"), { attended: 2, recorded: 3 });
  assert.deepEqual(summaries.get("arif"), { attended: 0, recorded: 1 });
  assert.equal(summaries.get("nadia"), undefined, "no sessions recorded, not 0 of 0");
  assert.equal(summarizeAttendance([]).size, 0);
});

test("the session history lists each date once, newest first, with how many were present", () => {
  assert.deepEqual(attendanceSessions([
    { sessionDate: "2026-10-21", present: true }, { sessionDate: "2026-10-28", present: false },
    { sessionDate: "2026-10-28", present: true }, { sessionDate: "2026-10-21", present: true }, { sessionDate: "2026-10-14", present: false },
  ]), [
    { date: "2026-10-28", present: 1, marked: 2 },
    { date: "2026-10-21", present: 2, marked: 2 },
    { date: "2026-10-14", present: 0, marked: 1 },
  ]);
  assert.deepEqual(attendanceSessions([]), []);
});

test("attendance percent is null before any session, not 0%", () => {
  assert.equal(attendancePercent({ attended: 2, recorded: 3 }), 67);
  assert.equal(attendancePercent({ attended: 0, recorded: 4 }), 0);
  assert.equal(attendancePercent({ attended: 0, recorded: 0 }), null);
  assert.equal(attendancePercent(undefined), null);
});
