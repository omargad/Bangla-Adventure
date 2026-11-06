import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

/** @type {() => never} */
const refuse = () => { throw new Error("Owned temporary CI acceptance state required."); };
const uid = () => typeof process.getuid === "function" ? process.getuid() : undefined;
function ownedRegular(file, mode) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (uid() !== undefined && st.uid !== uid()) || (mode !== undefined && (st.mode & 0o777) !== mode) || (st.mode & 0o022) !== 0 || fs.realpathSync(file) !== file) refuse();
}

/**
 * Re-reading an explicit owned marker supports Playwright's repeated config loading; arbitrary env paths never create state.
 * @param {{database?: string, qaId?: string, requireDatabase?: boolean}} options
 * @returns {{directory: string, database: string, qaId: string}}
 */
export function acceptanceCiState({ database, qaId, requireDatabase = false } = {}) {
  try {
    const temp = fs.realpathSync(os.tmpdir());
    if (!database && !qaId) {
      const directory = fs.mkdtempSync(path.join(temp, "bangla-acceptance-"));
      fs.chmodSync(directory, 0o700);
      qaId = randomBytes(12).toString("hex");
      database = path.join(directory, "acceptance.db");
      fs.writeFileSync(path.join(directory, ".acceptance-owner.json"), JSON.stringify({ kind: "bangla-acceptance-ci", qaId }), { flag: "wx", mode: 0o600 });
    }
    if (typeof database !== "string" || !/^[a-f0-9]{24}$/.test(qaId ?? "") || database !== path.resolve(database) || path.basename(database) !== "acceptance.db") refuse();
    const directory = path.dirname(database), stat = fs.lstatSync(directory);
    if (path.dirname(directory) !== temp || !path.basename(directory).startsWith("bangla-acceptance-") || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || (uid() !== undefined && stat.uid !== uid()) || fs.realpathSync(directory) !== directory) refuse();
    const marker = path.join(directory, ".acceptance-owner.json");
    ownedRegular(marker, 0o600);
    const value = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (Object.keys(value).sort().join(",") !== "kind,qaId" || value.kind !== "bangla-acceptance-ci" || value.qaId !== qaId) refuse();
    for (const name of ["acceptance.db", "acceptance.db-wal", "acceptance.db-shm"]) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate) || fs.lstatSync(candidate, { throwIfNoEntry: false })) ownedRegular(candidate);
      else if (name === "acceptance.db" && requireDatabase) refuse();
    }
    return { directory, database, qaId };
  } catch { refuse(); }
}
