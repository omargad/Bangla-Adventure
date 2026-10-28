import assert from "node:assert/strict";
import test from "node:test";

const { attachmentDisposition } = await import("../lib/csv.ts");

/** The plain and RFC 8187 file names a browser reads from the header. */
function fileNames(header) {
  const match = /^attachment; filename="([^"]*)"; filename\*=UTF-8''([^\s;"]+)$/.exec(header);
  assert.ok(match, `well-formed header: ${header}`);
  assert.match(match[1], /^[a-z0-9.-]+$/, "the fallback name is plain ASCII");
  assert.match(match[2], /^[A-Za-z0-9%!#$&+\-.^_`|~]+$/, "filename* uses only RFC 8187 attribute characters");
  return { ascii: match[1], utf8: decodeURIComponent(match[2]) };
}

test("an ASCII class name downloads under its slug and its own name", () => {
  const header = attachmentDisposition("Results class", "-grades.csv", "class");
  assert.equal(header, "attachment; filename=\"results-class-grades.csv\"; filename*=UTF-8''Results%20class-grades.csv");
  assert.deepEqual(fileNames(attachmentDisposition("Café (Level 1)", "-grades.csv", "class")), { ascii: "cafe-level-1-grades.csv", utf8: "Café (Level 1)-grades.csv" });
});

test("a Bangla-only class name keeps a non-empty ASCII fallback and its UTF-8 name", () => {
  const header = attachmentDisposition("বাংলা ক্লাস", "-grades.csv", "class");
  assert.deepEqual(fileNames(header), { ascii: "class-grades.csv", utf8: "বাংলা ক্লাস-grades.csv" });
  assert.ok(!header.includes("filename=\"-grades.csv\""), "not the old empty-name download");
});

test("a mixed name keeps the ASCII part in the fallback", () => {
  assert.deepEqual(fileNames(attachmentDisposition("Sunday ক্লাস ২", "-grades.csv", "class")), { ascii: "sunday-grades.csv", utf8: "Sunday ক্লাস ২-grades.csv" });
  assert.deepEqual(fileNames(attachmentDisposition("ক্লাস 3", "-grades.csv", "class")), { ascii: "3-grades.csv", utf8: "ক্লাস 3-grades.csv" });
});

test("quotes, slashes and other unsafe characters cannot break the header or the file name", () => {
  assert.deepEqual(fileNames(attachmentDisposition('Class "A"/B\\C', "-grades.csv", "class")), { ascii: "class-a-b-c-grades.csv", utf8: "Class -A-B-C-grades.csv" });
  assert.deepEqual(fileNames(attachmentDisposition("../../etc/passwd", "-grades.csv", "class")), { ascii: "etc-passwd-grades.csv", utf8: "..-..-etc-passwd-grades.csv" });
  assert.deepEqual(fileNames(attachmentDisposition("Tom's class*", "-grades.csv", "class")), { ascii: "tom-s-class-grades.csv", utf8: "Tom's class-grades.csv" });
  assert.deepEqual(fileNames(attachmentDisposition("a\r\nContent-Type: text/html", "-grades.csv", "class")), { ascii: "a-content-type-text-html-grades.csv", utf8: "a-Content-Type- text-html-grades.csv" });
  assert.deepEqual(fileNames(attachmentDisposition("x\ud800y", "-grades.csv", "class")), { ascii: "x-y-grades.csv", utf8: "x-y-grades.csv" }, "an unpaired surrogate does not throw");
  assert.deepEqual(fileNames(attachmentDisposition("/", "-grades.csv", "class")), { ascii: "class-grades.csv", utf8: "class-grades.csv" }, "nothing left falls back to the slug");
});
