import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Browsers compile an input's pattern attribute with the regular-expression `v` flag. A pattern
// that is invalid under `v` (for example an unescaped `-` at the end of a character class) is
// silently ignored and logs a console error, so the field accepts anything the server then refuses.
const root = path.resolve(import.meta.dirname, "../app");
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? files(full) : /\.(tsx|jsx)$/.test(entry.name) ? [full] : [];
});

test("every input pattern attribute is valid as a browser compiles it", () => {
  const patterns = files(root).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\spattern="([^"]*)"/g)].map((match) => ({ file: path.relative(root, file), pattern: match[1] })));
  assert.ok(patterns.length > 0);
  for (const { file, pattern } of patterns) {
    assert.doesNotThrow(() => new RegExp(`^(?:${pattern})$`, "v"), `${file}: pattern="${pattern}"`);
  }
});

test("the username pattern accepts the same names as the server", () => {
  const pattern = new RegExp("^(?:[a-zA-Z0-9._\\-]+)$", "v");
  for (const name of ["camel", "demo.maya", "qa-1_b"]) assert.ok(pattern.test(name), name);
  for (const name of ["two words", "a/b", "নাম"]) assert.ok(!pattern.test(name), name);
});
