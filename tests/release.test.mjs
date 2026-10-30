import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const workingDirectory = process.cwd();
const distDir = process.env.NEXT_DIST_DIR;
const root = mkdtempSync(path.join(tmpdir(), "bangla-release-"));
after(() => {
  process.chdir(workingDirectory);
  if (distDir === undefined) delete process.env.NEXT_DIST_DIR; else process.env.NEXT_DIST_DIR = distDir;
  rmSync(root, { recursive: true, force: true });
});

/** Each case loads its own copy of the module, so the value it caches starts empty. */
const load = async (name) => (await import(`../lib/release.ts?${name}`)).currentRelease;

test("the release is the build id from the build folder, read once", async () => {
  mkdirSync(path.join(root, ".next-release"));
  writeFileSync(path.join(root, ".next-release", "BUILD_ID"), "h7Kq2-build\n");
  process.chdir(root);
  process.env.NEXT_DIST_DIR = ".next-release";
  const currentRelease = await load("dist-dir");
  assert.equal(currentRelease(), "h7Kq2-build");
  writeFileSync(path.join(root, ".next-release", "BUILD_ID"), "another-build");
  assert.equal(currentRelease(), "h7Kq2-build", "a running server keeps the release it started with");
});

test("the default build folder is .next", async () => {
  mkdirSync(path.join(root, ".next"));
  writeFileSync(path.join(root, ".next", "BUILD_ID"), "default-build");
  process.chdir(root);
  delete process.env.NEXT_DIST_DIR;
  assert.equal((await load("default"))(), "default-build");
});

test("without a build (next dev) the release is development", async () => {
  process.chdir(root);
  process.env.NEXT_DIST_DIR = ".next-missing";
  assert.equal((await load("missing"))(), "development");
});
