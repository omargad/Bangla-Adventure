import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";

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

/**
 * Fixed English a component shows as text: JSX text, and strings shown as a child (also through conditions,
 * && and ||, and as values in an array of objects mapped into the page, such as [{ label: "Before" }].map(...)).
 * Text is fine inside a choice on the language (s(en, bn), paired(language, en, bn) or a condition on `language`)
 * or inside an element marked lang="en", which is how lesson content written in English is shown. A message
 * passed as an [en, bn] pair must have Bangla in its second half.
 */
function fixedEnglishText(source) {
  const file = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Product names stay as they are in both languages.
  const english = (text) => /[A-Za-z]/.test(text.replace(/\bYouTube\b/g, ""));
  const literalText = (node) => ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((span) => span.literal.text).join("") : node.text;
  const markedEnglish = (element) => element.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "lang" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "en");
  const chosen = (node) => {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && ["s", "paired"].includes(parent.expression.text)) return true;
      if (ts.isConditionalExpression(parent) && child !== parent.condition && /\blanguage\b/.test(parent.condition.getText())) return true;
      if (ts.isJsxElement(parent) && markedEnglish(parent.openingElement)) return true;
    }
    return false;
  };
  const shown = (node) => {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isJsxExpression(parent)) return ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent);
      if (ts.isParenthesizedExpression(parent) || (ts.isConditionalExpression(parent) && child !== parent.condition)) continue;
      // A value in an array of objects that is mapped into the page: [{ label: "Before" }].map(...).
      if ((ts.isPropertyAssignment(parent) && child === parent.initializer) || ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent)) continue;
      if ((ts.isPropertyAccessExpression(parent) || ts.isCallExpression(parent)) && child === parent.expression) continue;
      const logical = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];
      if (ts.isBinaryExpression(parent) && logical.includes(parent.operatorToken.kind) && child === parent.right) continue;
      return false;
    }
    return false;
  };
  const plainString = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const found = [];
  const visit = (node) => {
    if (ts.isArrayLiteralExpression(node) && ts.isCallExpression(node.parent) && node.parent.arguments.includes(node) && node.elements.length === 2 && node.elements.every(plainString)
      && english(node.elements[0].text) && !/[\u0980-\u09ff]/.test(node.elements[1].text)) found.push(node.getText());
    if (ts.isJsxText(node) && english(node.text) && !chosen(node)) found.push(node.text.trim());
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && shown(node) && english(literalText(node)) && !chosen(node)) found.push(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("lessons show no fixed English text: buttons, headings, hints and feedback all have a Bangla version", () => {
  assert.deepEqual(fixedEnglishText(read("components/LessonExperience.tsx")), []);
});

test("the text check finds fixed English in JSX text and shown strings, and accepts language choices", () => {
  assert.deepEqual(fixedEnglishText(`<button onClick={go}>Check my answers <span aria-hidden="true">✓</span></button>`), ["Check my answers"]);
  assert.deepEqual(fixedEnglishText(`<p>{done ? "✓ Complete" : ready && "Try again"}</p>`), ['"✓ Complete"', '"Try again"']);
  assert.deepEqual(fixedEnglishText("<p>{`Session ${step} of 6`}</p>"), ["`Session ${step} of 6`"]);
  assert.deepEqual(fixedEnglishText(`<p className={open ? "open card" : "card"} key="a">{s("Close", "বন্ধ")}{language === "en" ? "Next" : "পরের"}</p>`), []);
  assert.deepEqual(fixedEnglishText(`<p>{paired(language, "Quick check", "ছোট যাচাই")}<span lang="en">{lesson.title}: English data</span> · YouTube</p>`), []);
  assert.deepEqual(fixedEnglishText(`<p lang="bn">Mixed <span lang="en">text</span></p>`), ["Mixed"]);
  assert.deepEqual(fixedEnglishText(`<div>{[{ label: "Before", text: a }, { label: s("After", "পরে") }].map((item) => <b>{item.label}</b>)}</div>`), ['"Before"']);
  assert.deepEqual(fixedEnglishText(`<div className={["a", "b"].join(" ")} />`), []);
  assert.deepEqual(fixedEnglishText(`setRecordingError(["Recording failed", "Recording failed"]); setRecordingError(["Recording failed", "রেকর্ড হয়নি"]);`), ['["Recording failed", "Recording failed"]']);
});

test("a lesson session is a সেশন in Bangla: on the adventure page ধাপ names a level", () => {
  assert.doesNotMatch(read("components/LessonExperience.tsx"), /ধাপ/);
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
