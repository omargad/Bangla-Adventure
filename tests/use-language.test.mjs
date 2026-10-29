import assert from "node:assert/strict";
import test from "node:test";

const { localMessage, localNumber } = await import("../lib/use-language.ts");
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
