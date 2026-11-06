import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { acceptanceIdentities, runRoleAcceptance, ROLE_ISSUE_KINDS } from "../staging/role-acceptance-scenario.mjs";
import { acceptanceCiState } from "../staging/acceptance-ci-state.mjs";

test("fresh production server completes the same disposable four-role VPS acceptance scenario", async ({ browser, baseURL, request }, testInfo) => {
  const owned = acceptanceCiState({ database: process.env.BANGLA_ACCEPTANCE_DB, qaId: process.env.BANGLA_ACCEPTANCE_QA_ID });
  const qaId = owned.qaId, database = owned.database, identities = acceptanceIdentities(qaId);
  const marker = { qa: true, qa_id: qaId, expectedrevision: "95b6308ac7ad3d5b6bb2d951df9d65a23ff77107" };
  // The production server already knows this public static file. Only this temporary CI checkout
  // replaces its bytes; the actual HTTP response and the separate owned database are both checked.
  const robots = path.join(process.cwd(), "public", "robots.txt");
  const originalRobots = fs.readFileSync(robots);
  let phase = "verify-clean-clone", operation = "guard", lastStatus = 0;
  // Counts by fixed category only: browser messages can contain page data.
  const unexpected: Record<string, number> = {};
  const output = testInfo.outputPath(`role-acceptance-${qaId}`);
  fs.mkdirSync(output, { recursive: true });
  const emails = [identities.admin.email, identities.teacher.email, identities.parent.email];
  const names = identities.students.map((item) => item.username);
  const inspect = (expected: { users: number }) => {
    acceptanceCiState({ database, qaId, requireDatabase: true });
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try {
      const adults = db.prepare("SELECT id,email,role,status FROM adults WHERE email LIKE ?").all(`qa-${qaId}%`) as Array<{ id: string; email: string; role: string; status: string }>;
      const students = db.prepare("SELECT id,username,status FROM students WHERE username LIKE ?").all(`qa-${qaId}%`) as Array<{ id: string; username: string; status: string }>;
      expect(adults.length + students.length).toBe(expected.users);
      expect(adults.every((item) => emails.includes(item.email) && item.status === "active")).toBe(true);
      expect(students.every((item) => names.includes(item.username) && item.status === "active")).toBe(true);
      const classes = db.prepare("SELECT id,name,teacher_id FROM classes").all() as Array<{ id: string; name: string; teacher_id: string }>;
      expect(classes.length).toBeLessThanOrEqual(1);
      expect(classes.every((item) => item.name === `QA River Explorers ${qaId.slice(0, 6)}` && adults.some((adult) => adult.id === item.teacher_id && adult.email === identities.teacher.email))).toBe(true);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  };
  try {
    fs.writeFileSync(robots, JSON.stringify(marker));
    expect((await request.get("/api/health")).status()).toBe(200);
    inspect({ users: 0 });
    const result = await runRoleAcceptance({
      browser, baseURL: baseURL!, qaId, outputDirectory: output,
      guard: async (page: import("@playwright/test").Page, expected: { users: number }) => {
        inspect(expected);
        expect(new URL(page.url()).origin).toBe(baseURL);
        const value = await page.evaluate(async () => (await fetch("/robots.txt", { cache: "no-store" })).json());
        expect(value).toEqual(marker);
      },
      bootstrapAdmin: async () => {
        inspect({ users: 7 });
        const db = new Database(database);
        try {
          const row = db.prepare("SELECT id,role,approval_status FROM adults WHERE email=?").get(identities.admin.email) as { id: string; role: string; approval_status: string };
          expect(row.role).toBe("parent"); expect(row.approval_status).toBe("pending");
          expect(db.prepare("UPDATE adults SET role='admin',approval_status='approved' WHERE id=? AND role='parent' AND approval_status='pending'").run(row.id).changes).toBe(1);
        } finally { db.close(); }
      },
      onPhase: (value: string) => { phase = value; }, onOperation: (value: string) => { operation = value; }, onStatus: (value: number) => { lastStatus = value; },
      onIssue: (kind: string) => { if (ROLE_ISSUE_KINDS.includes(kind)) unexpected[kind] = (unexpected[kind] ?? 0) + 1; },
    });
    expect(result.roles.map((item) => item.role).sort()).toEqual(["admin", "parent", "student", "teacher"]);
    expect(result.screenshotCount).toBe(12);
    expect(result.scenario.fullyLoadedDashboards).toBe(true);
    fs.writeFileSync(path.join(output, "ci-result.json"), JSON.stringify({ passed: true, scenario: result.scenario, screenshotCount: result.screenshotCount }, null, 2));
  } catch {
    // Playwright's raw errors may echo .fill() values. Never publish them or their causes.
    fs.writeFileSync(path.join(output, "ci-diagnostics.json"), JSON.stringify({ passed: false, failedStep: phase, failedOperation: operation, lastResponseStatus: lastStatus, unexpectedBrowserErrors: unexpected }, null, 2));
    throw new Error(`Acceptance failed at fixed phase ${phase}, operation ${operation}, last response status ${lastStatus}, unexpected browser errors ${JSON.stringify(unexpected)}.`);
  } finally { fs.writeFileSync(robots, originalRobots); }
});
