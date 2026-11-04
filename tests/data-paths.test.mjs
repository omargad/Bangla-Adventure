import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

/**
 * DATABASE_PATH and MEDIA_ROOT as a host's settings page may leave them: empty, relative or ending in a slash.
 * Runs in its own empty directory, where the defaults (.data/...) land.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-data-paths-"));
process.chdir(dir);
const cwd = process.cwd();
after(() => {
  process.chdir(os.tmpdir());
  rmSync(dir, { recursive: true, force: true });
});
const { deleteMediaObject, getMediaObject, putMediaObject } = await import("../lib/storage.ts");
const key = "human-audio/hello-me/word-1/clip.ogg";

test("an empty DATABASE_PATH keeps the database in .data, not in SQLite's temporary store", async () => {
  process.env.DATABASE_PATH = "";
  const { getDb } = await import("../db/index.ts");
  const db = await getDb();
  try {
    assert.equal(db.$client.name, path.join(cwd, ".data", "bangla-adventures.db"));
    assert.ok(existsSync(db.$client.name));
  } finally {
    db.$client.close();
  }
});

test("a relative MEDIA_ROOT, or one ending in a slash, stores and reads media", async () => {
  for (const root of ["media-relative", "media-relative/", `${path.join(cwd, "media-absolute")}/`]) {
    process.env.MEDIA_ROOT = root;
    await putMediaObject(key, Buffer.from(root));
    assert.equal(readFileSync(path.resolve(root, key), "utf8"), root, root);
    assert.equal((await getMediaObject(key))?.toString(), root, root);
    await deleteMediaObject(key);
    assert.equal(await getMediaObject(key), null, root);
    await assert.rejects(putMediaObject("../outside.ogg", Buffer.from("x")), /Invalid media key/, root);
  }
});

test("an empty MEDIA_ROOT uses .data/media", async () => {
  process.env.MEDIA_ROOT = "";
  await putMediaObject(key, Buffer.from("default"));
  assert.equal(readFileSync(path.join(cwd, ".data", "media", key), "utf8"), "default");
});
