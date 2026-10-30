import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { default: PwaBridge } = await import("../app/components/PwaBridge.tsx");

test("the server renders an empty live region and no offline banner, even though Node's navigator has no onLine", () => {
  // The region is in the first markup so screen readers announce the banner when it appears later.
  assert.equal(renderToString(createElement(PwaBridge, { initialSessionKey: "", release: "test" })), '<div class="pwa-announcer" role="status" aria-live="polite" aria-atomic="true"></div>');
});

test("a new release never reloads the page by itself: only the visitor's Reload button does", () => {
  const source = readFileSync(new URL("../app/components/PwaBridge.tsx", import.meta.url), "utf8");
  const reloads = [...source.matchAll(/location\.reload\(\)/g)].map((match) => source.slice(Math.max(0, match.index - 40), match.index));
  assert.equal(reloads.length, 1);
  assert.match(reloads[0], /onClick=\{\(\) => window\.$/);
});

const app = new URL("../app/", import.meta.url);
const appFiles = readdirSync(app, { recursive: true }).filter((file) => file.endsWith(".tsx"));
const read = (file) => readFileSync(new URL(file, app), "utf8");
// A component has a language when it calls useLanguage, gets it from its page (a `language` prop or the
// portal), or keeps its own switch (the adventure page).
const hasLanguage = (source) => /useLanguage\(|usePortalLanguage\(|components\/PortalText"|\blanguage\??: (?:Language|"en" \| "bn")|useState<Language>/.test(source);

/** Fixed English in label, title, alt and placeholder attributes: plain strings and English-only expressions. */
function fixedEnglishLabels(source) {
  // Web addresses and code formats (ABC234, XXXXX-XXXXX) are the same in both languages.
  const words = (text) => !/^https:\/\//.test(text) && /[a-z]/.test(text.replace(/\$\{[^{}]*\}/g, ""));
  const found = [];
  for (const match of source.matchAll(/\b(aria-label|title|alt|placeholder)=(?:"([^"]*)"|\{)/g)) {
    if (match[2] !== undefined) {
      if (words(match[2])) found.push(match[0]);
      continue;
    }
    let end = match.index + match[0].length;
    for (let depth = 1; depth > 0 && end < source.length; end += 1) depth += source[end] === "{" ? 1 : source[end] === "}" ? -1 : 0;
    const expression = source.slice(match.index + match[0].length, end - 1);
    if (/[\u0980-\u09ff]/.test(expression)) continue;
    // A label made from English data (a word's `.en` or its transliteration) needs a Bangla form too.
    if (!/\bs\(|language/.test(expression) && /\.(?:en|transliteration)\b/.test(expression)) {
      found.push(`${match[1]}={${expression}}`);
      continue;
    }
    const literals = [...expression.matchAll(/"([^"]*)"|`([^`]*)`/g)].map((literal) => literal[1] ?? literal[2]).filter((text) => text !== "en" && text !== "bn");
    if (literals.some(words)) found.push(`${match[1]}={${expression}}`);
  }
  return found;
}

test("pages that switch language give every label and hint a Bangla version", () => {
  const bilingual = appFiles.filter((file) => hasLanguage(read(file))).concat("components/PortalShell.tsx", "grown-ups/AuthCard.tsx");
  for (const file of ["components/PwaBridge.tsx", "welcome/Welcome.tsx", "safety/SafetyContent.tsx", "student/StudentPortal.tsx", "learn/LearnHub.tsx", "components/LessonExperience.tsx", "components/FourSkillDiagnostic.tsx", "adventure/AdventureApp.tsx", "admin/FamilyLinks.tsx", "teach/TeacherDashboard.tsx", "worksheets/page.tsx", "worksheets/[lessonId]/page.tsx", "books/page.tsx"]) {
    assert.ok(bilingual.includes(file), file);
  }
  for (const file of bilingual) assert.deepEqual(fixedEnglishLabels(read(file)), [], `app/${file} has a fixed English label`);
});

test("the label check finds fixed English in every attribute form", () => {
  assert.deepEqual(fixedEnglishLabels(`<nav aria-label="Sections"><img alt="A boat" /><input placeholder="Write here" title="Hint" /></nav>`), ['aria-label="Sections"', 'alt="A boat"', 'placeholder="Write here"', 'title="Hint"']);
  assert.deepEqual(fixedEnglishLabels("<div aria-label={`Play line ${index + 1}`} />").length, 1);
  assert.deepEqual(fixedEnglishLabels(`<div aria-label={open ? "Close" : "Open"} />`).length, 1);
  assert.deepEqual(fixedEnglishLabels(`<div aria-label={s("Sections", "বিভাগ")} title={t.close} alt={\`\${t.listen}: \${word.bn}\`} placeholder="https://" />`), []);
  assert.deepEqual(fixedEnglishLabels(`<input placeholder="XXXXX-XXXXX" aria-label={language === "bn" ? level.bn : level.en} />`), []);
  assert.equal(fixedEnglishLabels("<button aria-label={`${phrase.transliteration} — ${phrase.en}`} />").length, 1);
  assert.equal(fixedEnglishLabels("<div aria-label={`${value} ${countable.en}`} />").length, 1);
  assert.deepEqual(fixedEnglishLabels("<button aria-label={s(`${phrase.transliteration} — ${phrase.en}`, phrase.bn)} />"), []);
});

test("language buttons are marked with the language their label is written in", () => {
  const toggle = /\{s\("বাংলা(?:য় দেখুন)?", "(?:View in )?English"\)\}|\{t\.langToggle\}/g;
  let buttons = 0;
  for (const file of appFiles) {
    const source = read(file);
    for (const match of source.matchAll(toggle)) {
      buttons += 1;
      const opening = source.slice(source.lastIndexOf("<button", match.index), match.index);
      assert.match(opening, /\blang=\{language === "bn" \? "en" : "bn"\}/, `app/${file}: the language button has no lang`);
    }
  }
  assert.ok(buttons >= 24, `found only ${buttons} language buttons`);
  const adventure = read("adventure/AdventureApp.tsx");
  assert.match(adventure, /<button\s+type="button"\s+lang="en"[^]*?>\s*EN\s*<\/button>/);
  assert.match(adventure, /<button\s+type="button"\s+lang="bn"[^]*?>\s*বাংলা\s*<\/button>/);
});

test("Bangla tab titles belong to their page: the English half is the page's own title", () => {
  const siteTitle = readFileSync(new URL("../lib/site-title.ts", import.meta.url), "utf8").match(/\[\s*("[^"]*")/)[1];
  const titleOf = (text) => text.trim() === "siteTitle" ? siteTitle : text.trim().replace(/^\[\s*/, "").split(/,\s*(?=["`])/)[0];
  for (const page of appFiles.filter((file) => file.endsWith("page.tsx"))) {
    const source = read(page);
    const metadata = source.slice(0, source.indexOf("export default"));
    const titles = [...metadata.matchAll(/\btitle: ("[^"]*"|`[^`]*`)/g)].map((match) => match[1]);
    if (titles.length === 0) titles.push(siteTitle);
    const directory = page.slice(0, -"page.tsx".length);
    const parts = [...source.matchAll(/from "\.\/([^"]+)"/g)].map((match) => `${directory}${match[1]}.tsx`).filter((file) => appFiles.includes(file) && read(file).includes("useLanguage("));
    if (source.includes("<PageTitle")) parts.push(page);
    for (const part of parts) {
      const given = read(part).match(/useLanguage\(\{[^}]*\btitle: ([^}]*?)\s*\}\)|<PageTitle title=\{(\[[^\]]*\])\}/);
      assert.ok(given, `app/${part} gives no Bangla tab title for app/${page}`);
      const title = given[1] ?? given[2];
      assert.ok(titles.includes(titleOf(title)), `app/${part}: ${titleOf(title)} is not the title of app/${page} (${titles.join(", ")})`);
      if (title.trim() !== "siteTitle") assert.match(title, /[\u0980-\u09ff]/, `app/${part} has no Bangla title`);
    }
  }
});
