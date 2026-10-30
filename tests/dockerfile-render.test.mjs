import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const lines = (file) => readFileSync(new URL(file, root), "utf8").replace(/\r\n/g, "\n").split("\n");
const RENDER_SCRIPTS_COPY = "COPY --from=builder /app/scripts/render-start.sh /app/scripts/render-run-as-app.sh ./scripts/";

/** Lines before the first one that starts with `marker`, numbered as in the file. */
function before(file, all, marker, from = 0) {
  const end = all.findIndex((line) => line.startsWith(marker));
  assert.ok(end >= 0, `${file} has no line starting with "${marker}"`);
  return all.slice(from, end).map((text, index) => ({ text, number: from + index + 1 }));
}

/** Where the build starts: comments and parser directives above the first FROM are each file's own. */
function firstFrom(file, all) {
  const index = all.findIndex((line) => line.startsWith("FROM "));
  assert.ok(index >= 0, `${file} has no FROM line`);
  return index;
}

test("Dockerfile.render matches ./Dockerfile above its RENDER section, apart from the Render scripts", () => {
  const render = lines("Dockerfile.render");
  const ours = before("Dockerfile.render", render, "# RENDER:", firstFrom("Dockerfile.render", render));
  const copies = ours.filter((line) => line.text === RENDER_SCRIPTS_COPY);
  assert.equal(copies.length, 1, `Dockerfile.render must copy the Render scripts exactly once with:\n  ${RENDER_SCRIPTS_COPY}`);
  const compared = ours.filter((line) => line !== copies[0]);
  const dockerfile = lines("Dockerfile");
  const base = before("Dockerfile", dockerfile, "# Persistent state", firstFrom("Dockerfile", dockerfile));
  for (let i = 0; i < Math.max(compared.length, base.length); i++) {
    const mine = compared[i], theirs = base[i];
    assert.ok(mine && theirs && mine.text === theirs.text, [
      "Dockerfile.render has drifted from ./Dockerfile above its RENDER section:",
      `  Dockerfile.render:${mine ? `${mine.number}: ${mine.text}` : " (ends here)"}`,
      `  Dockerfile:${theirs ? `${theirs.number}: ${theirs.text}` : " (ends here)"}`,
      "Make the same change in both files.",
    ].join("\n"));
  }
});

test("the Render image starts through its start script, and both Render scripts exist", () => {
  const render = lines("Dockerfile.render");
  assert.equal(render.filter((line) => line.startsWith("CMD ")).at(-1), 'CMD ["scripts/render-start.sh"]');
  for (const script of ["scripts/render-start.sh", "scripts/render-run-as-app.sh"]) assert.ok(existsSync(new URL(script, root)), `${script} is missing`);
});
