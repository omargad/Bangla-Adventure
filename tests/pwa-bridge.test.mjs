import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { default: PwaBridge } = await import("../app/components/PwaBridge.tsx");

test("the server renders no offline banner, even though Node's navigator has no onLine", () => {
  assert.equal(renderToString(createElement(PwaBridge, { initialSessionKey: "", release: "test" })), "");
});

test("pages that switch language give every label and hint a Bangla version", () => {
  const files = ["app/components/PwaBridge.tsx", "app/components/PortalShell.tsx", "app/welcome/Welcome.tsx", "app/grown-ups/GrownUpsContent.tsx", "app/grown-ups/AuthCard.tsx", "app/safety/SafetyContent.tsx", "app/student/StudentPortal.tsx", "app/admin/UserManagement.tsx"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.deepEqual(source.match(/\b(?:aria-label|title)="[^"]*[A-Za-z][^"]*"/g) ?? [], [], `${file} has a fixed English label`);
  }
});
