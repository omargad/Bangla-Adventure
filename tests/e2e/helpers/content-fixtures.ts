import { expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

/** Account bootstrap only. Content publication must go through the real Admin APIs. */
function approveFixtureAccount(kind: "admin" | "student", identifier: string) {
  const filename = process.env.BANGLA_E2E_DB;
  if (!filename || !path.resolve(filename).startsWith(path.join(os.tmpdir(), "bangla-e2e-"))) {
    throw new Error("Content fixtures require an isolated, temporary E2E database.");
  }
  const db = new Database(filename);
  try {
    const result = kind === "admin"
      ? db.prepare("UPDATE adults SET role='admin', approval_status='approved' WHERE email=?").run(identifier)
      : db.prepare("UPDATE students SET approval_status='approved' WHERE username=?").run(identifier);
    expect(result.changes).toBe(1);
  } finally { db.close(); }
}

/** Browser fetch retains the loopback Secure session cookie in production mode. */
export async function browserApi(page: Page, method: string, url: string, data?: unknown) {
  return page.evaluate(async ({ method, url, data }) => {
    const response = await fetch(url, {
      method,
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }, { method, url, data });
}

export async function createFixtureAccount(browser: Browser, baseURL: string | undefined, kind: "admin" | "student", label = "FixtureSetup") {
  const suffix = randomUUID().slice(0, 10), password = "Isolated-content-fixture-2026";
  const identifier = `fixture-${kind}-${suffix}${kind === "admin" ? "@example.com" : ""}`;
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `fixture-${kind}-${suffix}` } });
  const credentials = kind === "admin" ? { email: identifier, password } : { username: identifier, password };
  const endpoint = kind === "admin" ? "/api/auth" : "/api/student";
  expect((await context.request.post(`${endpoint}/sign-up`, { data: { ...credentials, displayName: `${label} ${kind} ${suffix}` } })).status()).toBe(201);
  approveFixtureAccount(kind, identifier);
  expect((await context.request.post(`${endpoint}/sign-in`, { data: credentials })).status()).toBe(200);
  const page = await context.newPage();
  await page.goto(kind === "admin" ? "/admin" : "/student");
  return { context, page, identifier };
}
