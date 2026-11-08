import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { topics, topicThemes } = await import("../app/topics-content.ts");
const { lessons, levelBands, lessonCategories } = await import("../app/curriculum.ts");
const { lessonSourceBridges } = await import("../app/nctb-content.ts");

// docs/content-review-worksheet.csv is written by hand for the first administrator's review
// (docs/CONTENT_REVIEW_PACK.md). This test fails when a topic or lesson changes in the code and
// the worksheet was not updated to match; after updating the CSV, rebuild the Excel copy with
// scripts/build-content-review-workbook.py.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(new URL("../docs/content-review-worksheet.csv", import.meta.url), "utf8").replace(/^﻿/, "");
const [header, ...body] = parseCsv(text);
const rows = body.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])));

test("the content review worksheet lists every shipped topic and lesson, in order", () => {
  assert.deepEqual(
    rows.map((row) => `${row.Type} ${row.ID}`),
    [...topics.map((topic) => `Topic ${topic.id}`), ...lessons.map((lesson) => `Lesson ${lesson.id}`)],
  );
});

test("the worksheet's topic rows match the topics in the code", () => {
  for (const topic of topics) {
    const row = rows.find((candidate) => candidate.Type === "Topic" && candidate.ID === topic.id);
    assert.equal(row["Title (English)"], topic.title.en, topic.id);
    assert.equal(row["Title (Bangla)"], topic.title.bn, topic.id);
    assert.equal(row["Category or band"], topicThemes.find((theme) => theme.id === topic.theme).title.en, topic.id);
    assert.equal(row["Has quiz"], `Yes (${topic.quiz.length} questions)`, topic.id);
    for (const source of topic.sources) assert.ok(row.Source.includes(source.note.en), `${topic.id}: ${source.note.en}`);
  }
});

test("the worksheet's lesson rows match the lessons in the code", () => {
  for (const lesson of lessons) {
    const row = rows.find((candidate) => candidate.Type === "Lesson" && candidate.ID === lesson.id);
    const band = levelBands.find((item) => item.id === lesson.level);
    const category = lessonCategories.find((item) => item.id === lesson.category);
    assert.equal(row["Title (English)"], lesson.title, lesson.id);
    assert.equal(row["Title (Bangla)"], lesson.titleBn, lesson.id);
    assert.equal(row["Category or band"], `${band.title} (${band.code}) · ${category.title.en}`, lesson.id);
    assert.equal(row["Has quiz"], `Yes (${lesson.quiz.length} questions)`, lesson.id);
    for (const part of [lesson.video.title, lesson.video.channel, lesson.video.duration, lesson.video.id]) {
      assert.ok(row["Has video"].includes(part), `${lesson.id}: video ${part}`);
    }
    const bridges = lessonSourceBridges.filter((bridge) => bridge.lessonId === lesson.id);
    if (bridges.length === 0) assert.ok(row.Source.startsWith("No NCTB source recorded."), lesson.id);
    for (const bridge of bridges) assert.ok(row.Source.includes(bridge.evidenceAnchor), `${lesson.id}: ${bridge.evidenceAnchor}`);
  }
});

test("the worksheet's reviewer columns are empty", () => {
  for (const row of rows) {
    for (const column of ["Reviewer", "Date reviewed", "Decision", "Notes"]) assert.equal(row[column], "", `${row.ID} ${column}`);
  }
});
