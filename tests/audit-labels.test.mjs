import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

/** Every .ts and .tsx source file under these folders. */
function sources(...folders) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) files.push(full);
    }
  };
  for (const folder of folders) walk(path.join(root, folder));
  return files;
}

/** The labels Recent changes shows, by action code. */
function labelledActions() {
  const page = readFileSync(path.join(root, "app/admin/UserManagement.tsx"), "utf8");
  const block = page.slice(page.indexOf("const AUDIT_ACTIONS"), page.indexOf("};", page.indexOf("const AUDIT_ACTIONS")));
  return new Map([...block.matchAll(/^\s*(?:"([a-z-]+)"|([a-z]+)):\s*\["([^"]+)",\s*"([^"]+)"\]/gm)].map((match) => [match[1] ?? match[2], [match[3], match[4]]]));
}

/**
 * The action codes written to the audit log: `action: "…"` in an insert, the code given to an audit
 * helper (`audit(tx, …, "…")`, `auditClass(tx, …, "…")`, `auditOwnAccount(tx, …, "…")`, `record(tx, …, "…")`), and the codes
 * those helpers are handed in a variable.
 */
function writtenActions() {
  const codes = new Set();
  for (const file of [...sources("lib", "app"), ...sources("scripts")]) {
    const text = readFileSync(file, "utf8");
    // A file that writes audit rows itself, or through the class audit helper (lib/class-audit.ts).
    if (!/userAuditEvents|user_audit_events|\bauditClass\(/.test(text)) continue;
    for (const match of text.matchAll(/\baction(?:_?[A-Za-z]*)?:\s*"([a-z][a-z-]*)"/g)) codes.add(match[1]);
    for (const line of text.split("\n")) {
      // An audit helper call or a line choosing the action code: every kebab-case literal on it is a code.
      if (!/\b(?:audit|auditClass|auditOwnAccount|record)\(tx,|const action = |audited = /.test(line)) continue;
      for (const match of line.matchAll(/"([a-z]+(?:-[a-z]+)+)"/g)) codes.add(match[1]);
      for (const match of line.matchAll(/`([a-z]+(?:-[a-z]+)*)-\$\{/g)) codes.add(`${match[1]}-*`);
    }
  }
  return codes;
}

// Strings on those lines that name the kind of target, not the action.
const TARGET_TYPES = new Set(["class-student", "library-source"]);

test("every action written to the audit log has a label in both languages on Recent changes", () => {
  const labels = labelledActions();
  const written = writtenActions();
  // Plain codes from user management's own helper, which takes the action from the request.
  for (const code of ["created", "update", "approve", "reject", "revoke-sessions", "account-approved", "account-declined"]) written.add(code);
  // A recording review writes lesson-audio-<review status>.
  if (written.delete("lesson-audio-*")) for (const status of ["pending", "changes-requested", "approved", "retired"]) written.add(`lesson-audio-${status}`);
  // An account decision writes account-approved or account-declined, added above.
  written.delete("account-*");
  for (const type of TARGET_TYPES) written.delete(type);
  assert.ok(written.size > 40, `found only ${written.size} codes: the scan is broken`);
  const missing = [...written].filter((code) => !labels.has(code)).sort();
  assert.deepEqual(missing, [], `actions without a label: ${missing.join(", ")}`);
  for (const [code, [en, bn]] of labels) {
    assert.ok(en.trim() && bn.trim(), code);
    assert.notEqual(en, bn, `${code} needs a Bangla label`);
  }
});

test("the scan sees the codes written through the class audit helper", () => {
  const written = writtenActions();
  for (const code of ["attendance-saved", "class-activity-opened", "class-activity-closed", "class-created", "announcement-posted", "class-source-added", "class-deleted"]) {
    assert.ok(written.has(code), code);
  }
});

test("the scan sees the codes written through the own-account audit helper", () => {
  const written = writtenActions();
  for (const code of ["password-recovered", "recovery-codes-replaced", "signed-out-everywhere", "password-changed"]) {
    assert.ok(written.has(code), code);
  }
});

test("class activity labels use the word the class pages use for an activity (কার্যক্রম)", () => {
  const activityLabels = [...labelledActions()].filter(([code]) => code.startsWith("class-activity-"));
  assert.equal(activityLabels.length, 5);
  for (const [code, [, bn]] of activityLabels) assert.match(bn, /^ক্লাসের কার্যক্রম /, code);
});

test("the action codes agreed for account and class events are labelled", () => {
  const labels = labelledActions();
  for (const code of ["account-deleted", "password-recovered", "recovery-codes-replaced", "signed-out-everywhere", "class-created", "announcement-posted", "class-activity-opened", "class-activity-closed", "attendance-saved"]) {
    assert.ok(labels.has(code), code);
  }
});
