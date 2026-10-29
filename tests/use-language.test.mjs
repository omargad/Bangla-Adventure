import assert from "node:assert/strict";
import test from "node:test";

const { localDate, localDateTime, localMessage, localNumber } = await import("../lib/use-language.ts");
const fallback = ["Could not load.", "লোড করা যায়নি।"];

test("server messages are shown in the page language", () => {
  const data = { error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" };
  assert.equal(localMessage(data, "en", fallback), "Class not found.");
  assert.equal(localMessage(data, "bn", fallback), "ক্লাসটি পাওয়া যায়নি।");
  assert.equal(localMessage({ message: "Saved.", messageBn: "সংরক্ষণ হয়েছে।" }, "bn", fallback), "সংরক্ষণ হয়েছে।");
});

test("Bangla pages show the Bangla fallback, never English, when the server sent no Bangla copy", () => {
  assert.equal(localMessage({ error: "Too many attempts." }, "bn", fallback), "লোড করা যায়নি।");
  assert.equal(localMessage({ error: "Too many attempts." }, "en", fallback), "Too many attempts.");
  for (const data of [null, undefined, {}, { error: 42 }, { error: "", errorBn: "" }]) {
    assert.equal(localMessage(data, "en", fallback), "Could not load.");
    assert.equal(localMessage(data, "bn", fallback), "লোড করা যায়নি।");
  }
});

test("numbers use Bangla digits in Bangla mode", () => {
  assert.equal(localNumber(200, "bn"), "২০০");
  assert.equal(localNumber(200, "en"), "200");
});

test("stored times are shown in local time in the page language, never as raw timestamps", () => {
  const sqlite = localDateTime("2026-10-28 06:41:12", "en");
  assert.equal(sqlite, localDateTime("2026-10-28T06:41:12.000Z", "en"), "SQLite's zone-less CURRENT_TIMESTAMP is UTC");
  assert.ok(!/T06:41|06:41:12/.test(sqlite));
  assert.match(sqlite, /2026/);
  assert.match(localDateTime("2026-10-28T06:41:12.000Z", "bn"), /২০২৬/);
  assert.equal(localDateTime("not a time", "en"), "not a time");
});

test("class dates keep their calendar day in every time zone", () => {
  assert.match(localDate("2026-10-28", "en"), /28 Oct 2026/);
  assert.match(localDate("2026-10-28", "bn"), /২৮/);
  assert.match(localDate("2026-01-01", "en"), /1 Jan 2026/);
  assert.equal(localDate("28/10/2026", "en"), "28/10/2026");
});
