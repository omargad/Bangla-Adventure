import assert from "node:assert/strict";
import test from "node:test";

const { buildGradebook, filterGradebookRows, gradebookCsvRows } = await import("../lib/gradebook.ts");

const students = [
  { id: "roster-zara", displayName: "Zara", username: "zara", attendance: { attended: 1, recorded: 2 } },
  { id: "roster-arif", displayName: "arif", username: "arif.h", attendance: { attended: 0, recorded: 0 } },
  { id: "roster-maya", displayName: "Maya", username: "maya", attendance: null },
];
const activities = [
  { id: "quiz-old", title: "Alphabet quiz", createdAt: "2026-10-01 09:00:00", submissions: [
    { id: "s1", studentId: "roster-maya", score: 2, total: 4, submittedAt: "2026-10-02T10:00:00.000Z" },
    { id: "s2", studentId: "roster-zara", score: 0, total: 4, submittedAt: "2026-10-02T11:00:00.000Z" },
    { id: "s-removed", studentId: "roster-removed", score: 4, total: 4, submittedAt: "2026-10-02T12:00:00.000Z" },
  ] },
  { id: "quiz-new", title: "Festivals check-in, a long title that the header truncates", createdAt: "2026-10-20 09:00:00", submissions: [
    { id: "s3", studentId: "roster-maya", score: 3, total: 3, submittedAt: "2026-10-21T10:00:00.000Z" },
  ] },
];

test("one row per student A–Z and one column per activity, newest first", () => {
  const gradebook = buildGradebook(students, activities);
  assert.deepEqual(gradebook.activities.map((activity) => activity.id), ["quiz-new", "quiz-old"]);
  assert.deepEqual(gradebook.rows.map((row) => row.student.displayName), ["arif", "Maya", "Zara"], "names sort ignoring case");
  assert.deepEqual(gradebook.rows[1].student, { id: "roster-maya", displayName: "Maya", username: "maya" });
});

test("a missing submission is null, unlike a score of zero, and is not counted as done", () => {
  const [arif, maya, zara] = buildGradebook(students, activities).rows;
  assert.deepEqual(arif.cells, [null, null]);
  assert.equal(arif.done, 0);
  assert.equal(arif.averagePercent, null, "nothing submitted is not 0%");
  assert.deepEqual(zara.cells, [null, { id: "s2", score: 0, total: 4, submittedAt: "2026-10-02T11:00:00.000Z" }]);
  assert.equal(zara.done, 1);
  assert.equal(zara.averagePercent, 0, "a real zero");
  assert.equal(maya.done, 2);
  assert.equal(maya.averagePercent, 71, "score-weighted over submitted work: 5 of 7");
});

test("students who are not in the class are left out, and attendance is carried through", () => {
  const gradebook = buildGradebook(students, activities);
  assert.ok(!JSON.stringify(gradebook).includes("s-removed"));
  assert.deepEqual(gradebook.rows.map((row) => row.attendance), [{ attended: 0, recorded: 0 }, null, { attended: 1, recorded: 2 }]);
  assert.deepEqual(buildGradebook([], activities).rows, []);
  assert.deepEqual(buildGradebook(students, []).rows.map((row) => [row.cells.length, row.done]), [[0, 0], [0, 0], [0, 0]]);
});

test("the name filter matches name or username, ignoring case", () => {
  const { rows } = buildGradebook(students, activities);
  assert.deepEqual(filterGradebookRows(rows, " MAY ").map((row) => row.student.id), ["roster-maya"]);
  assert.deepEqual(filterGradebookRows(rows, "arif.h").map((row) => row.student.id), ["roster-arif"]);
  assert.equal(filterGradebookRows(rows, "").length, 3);
  assert.equal(filterGradebookRows(rows, "nobody").length, 0);
});

test("the CSV keeps one row per submission and adds done and attendance, with a row for students who submitted nothing", () => {
  const [header, ...rows] = gradebookCsvRows("Sunday Class", buildGradebook(students, activities));
  assert.deepEqual(header, ["Class", "Activity", "Student", "Score", "Total", "Percent", "Submitted At", "Done", "Attendance"]);
  assert.deepEqual(rows, [
    ["Sunday Class", "", "arif", "", "", "", "", "0 of 2", ""],
    ["Sunday Class", "Festivals check-in, a long title that the header truncates", "Maya", 3, 3, 100, "2026-10-21T10:00:00.000Z", "2 of 2", ""],
    ["Sunday Class", "Alphabet quiz", "Maya", 2, 4, 50, "2026-10-02T10:00:00.000Z", "2 of 2", ""],
    ["Sunday Class", "Alphabet quiz", "Zara", 0, 4, 0, "2026-10-02T11:00:00.000Z", "1 of 2", "1 of 2"],
  ]);
});
