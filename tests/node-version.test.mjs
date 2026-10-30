import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The app runs on Node 22. package.json's range starts at the oldest Node 22 that every locked dependency
 * installed on Linux supports, so it never promises a runtime the dependency tree cannot run on.
 */
const text = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pkg = JSON.parse(text("package.json"));
const lock = JSON.parse(text("package-lock.json"));

const parse = (version) => version.split(".").map(Number);
function compare(a, b) {
  for (let index = 0; index < 3; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
}
/** Enough of npm's range syntax for engines fields: ||, >=, >, <, <=, ^, partial versions (20 means 20.x) and *. */
function satisfies(version, range) {
  const wanted = parse(version);
  return range.split("||").some((alternative) => alternative.trim().replace(/([<>]=?|\^)\s+/g, "$1").split(/\s+/).every((comparator) => {
    const [, operator, bound] = comparator.match(/^(>=|<=|>|<|\^|)(.*)$/);
    if (bound === "*") return true;
    const parts = parse(bound);
    assert.ok(parts.every(Number.isInteger) && !(operator === "^" && parts[0] === 0), `cannot read the range ${range}`);
    const order = compare(wanted, parts);
    if (operator === ">=") return order >= 0;
    if (operator === ">") return order > 0;
    if (operator === "<") return order < 0;
    if (operator === "<=") return order <= 0;
    if (operator === "^") return order >= 0 && wanted[0] === parts[0];
    return parts.every((part, index) => wanted[index] === part);
  }));
}

test("the range check reads engines fields the way npm does", () => {
  assert.equal(satisfies("22.12.0", "^20.19.0 || ^22.13.0 || >=24"), false);
  assert.equal(satisfies("22.13.0", "^20.19.0 || ^22.13.0 || >=24"), true);
  assert.equal(satisfies("22.2.0", ">=20.16.0 <21 || >=22.3.0"), false);
  assert.equal(satisfies("22.13.0", "18 || 20 || >=22"), true);
  assert.equal(satisfies("21.0.0", "18 || 20 || >=22"), false);
  assert.equal(satisfies("22.13.0", ">= 0.4"), true);
  assert.equal(satisfies("23.0.0", ">=22.13 <23"), false);
});

test("package.json allows only Node 22, from the oldest 22.x every locked dependency supports", () => {
  const range = pkg.engines.node;
  assert.equal(lock.packages[""].engines.node, range, "package-lock.json's root entry matches package.json");
  const floor = range.match(/^>=(22\.\d+(?:\.\d+)?) <23$/)?.[1];
  assert.ok(floor, `engines.node is ${range}, not a Node 22 range`);
  const unsupported = Object.entries(lock.packages)
    .filter(([name, entry]) => name && typeof entry.engines?.node === "string" && (!entry.os || entry.os.includes("linux")))
    .filter(([, entry]) => !satisfies(floor, entry.engines.node))
    .map(([name, entry]) => `${name} needs ${entry.engines.node}`);
  assert.deepEqual(unsupported, [], `Node ${floor} is too old for these locked packages`);
});

test(".nvmrc, both Dockerfiles and every CI workflow run Node 22", () => {
  assert.equal(text(".nvmrc").trim(), "22");
  for (const file of ["Dockerfile", "Dockerfile.render"]) {
    const images = [...text(file).matchAll(/^FROM (node:\S+)/gm)].map((match) => match[1]);
    assert.ok(images.length > 0 && images.every((image) => image.startsWith("node:22-")), `${file} uses ${images.join(", ")}`);
  }
  for (const file of readdirSync(new URL("../.github/workflows/", import.meta.url))) {
    for (const [, version] of text(`.github/workflows/${file}`).matchAll(/node-version: *(\S+)/g)) assert.equal(version, "22", `${file} sets node-version ${version}`);
  }
});
