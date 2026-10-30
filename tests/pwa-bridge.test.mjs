import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { default: PwaBridge } = await import("../app/components/PwaBridge.tsx");

test("the server renders no offline banner, even though Node's navigator has no onLine", () => {
  assert.equal(renderToString(createElement(PwaBridge, { initialSessionKey: "", release: "test" })), "");
});

test("pages that switch language give every label and hint a Bangla version", () => {
  const app = new URL("../app/", import.meta.url);
  const files = readdirSync(app, { recursive: true }).filter((file) => file.endsWith(".tsx"));
  // Files that call useLanguage, plus parts that get the language from their page.
  const bilingual = files.filter((file) => readFileSync(new URL(file, app), "utf8").includes("useLanguage(")).concat("components/PortalShell.tsx", "grown-ups/AuthCard.tsx");
  for (const file of ["components/PwaBridge.tsx", "welcome/Welcome.tsx", "safety/SafetyContent.tsx", "student/StudentPortal.tsx", "learn/LearnHub.tsx"]) assert.ok(bilingual.includes(file), file);
  for (const file of bilingual) {
    const source = readFileSync(new URL(file, app), "utf8");
    assert.deepEqual(source.match(/\b(?:aria-label|title)="[^"]*[A-Za-z][^"]*"/g) ?? [], [], `app/${file} has a fixed English label`);
  }
});
