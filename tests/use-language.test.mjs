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

test("a server message is kept in both languages, with the fallback for a language the server did not send", async () => {
  const { serverMessage, MessageError } = await import("../lib/use-language.ts");
  assert.deepEqual(serverMessage({ error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" }, fallback), ["Class not found.", "ক্লাসটি পাওয়া যায়নি।"]);
  assert.deepEqual(serverMessage({ error: "Too many attempts." }, fallback), ["Too many attempts.", "লোড করা যায়নি।"]);
  assert.deepEqual(serverMessage(null, fallback), fallback);
  const error = new MessageError(["Not saved.", "সংরক্ষণ হয়নি।"]);
  assert.equal(error.message, "Not saved.");
  assert.deepEqual(error.text, ["Not saved.", "সংরক্ষণ হয়নি।"]);
});

test("the server renders a page in the language chosen in the cookie, so it hydrates without switching", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { LanguageProvider, useLanguage } = await import("../lib/use-language.ts");
  const { default: PwaBridge } = await import("../app/components/PwaBridge.tsx");
  function Heading() {
    const [language] = useLanguage();
    return createElement("h1", { lang: language }, language === "bn" ? "আমার শেখা" : "My Learning");
  }
  const page = (initialLanguage) => renderToString(createElement(LanguageProvider, { initialLanguage }, createElement(Heading), createElement(PwaBridge, { initialSessionKey: "", release: "test" })));
  assert.equal(page("bn"), '<h1 lang="bn">আমার শেখা</h1><div class="pwa-announcer" role="status" aria-live="polite" aria-atomic="true"></div>');
  assert.equal(page("en"), '<h1 lang="en">My Learning</h1><div class="pwa-announcer" role="status" aria-live="polite" aria-atomic="true"></div>');
  // Outside the root layout (no provider) a part starts in English, as before.
  assert.equal(renderToString(createElement(Heading)), '<h1 lang="en">My Learning</h1>');
});

test("only the two languages are read from the cookie, which keeps a choice for a year on the whole site", async () => {
  const { chosenLanguage, languageCookie, LANGUAGE_COOKIE } = await import("../lib/language-choice.ts");
  assert.equal(chosenLanguage("bn"), "bn");
  assert.equal(chosenLanguage("en"), "en");
  for (const value of [undefined, null, "", "BN", "fr", "bn; Path=/"]) assert.equal(chosenLanguage(value), null);
  assert.equal(languageCookie("bn", false), `${LANGUAGE_COOKIE}=bn; Path=/; Max-Age=31536000; SameSite=Lax`);
  assert.equal(languageCookie("en", true), `${LANGUAGE_COOKIE}=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
});
