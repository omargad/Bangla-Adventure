import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Full HTTP integration test against the production server.
 * Requires `npm run build` to have produced `.next` first (CI runs it after the build step).
 */

const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-int-"));
let server;

function cookieFrom(response) {
  const header = response.headers.getSetCookie?.() ?? [];
  const session = header.find((value) => value.startsWith("ba_adult_session="));
  return session ? session.split(";")[0] : null;
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/safety`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Server did not become ready in time");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_PATH: path.join(stateDir, "test.db"),
      MEDIA_ROOT: path.join(stateDir, "media"),
    },
    stdio: "ignore",
  });
  await waitForServer();
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
});

let cookie;
let recoveryCodes;
let profileId;

test("health endpoint reports ok when the database is reachable", async () => {
  const response = await fetch(`${BASE}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, "ok");
});

test("anonymous home redirects safely behind an HTTPS reverse proxy", async () => {
  const response = await fetch(`${BASE}/`, { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), BASE).pathname, "/welcome");
  assert.ok(!response.headers.get("location").includes("localhost:3300"));
});

test("sign-up issues recovery codes and the account signs in once approved", async () => {
  const response = await fetch(`${BASE}/api/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "it@example.com",
      displayName: "Integration Parent",
      password: "integration-pass-1",
    }),
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.adult.email, "it@example.com");
  assert.equal(data.adult.approvalStatus, "pending");
  assert.equal(data.pendingApproval, true);
  assert.equal(data.recoveryCodes.length, 8);
  recoveryCodes = data.recoveryCodes;
  assert.equal(cookieFrom(response), null, "no session until an administrator approves");

  const signIn = () => fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "it@example.com", password: "integration-pass-1" }),
  });
  const waiting = await signIn();
  assert.equal(waiting.status, 403);
  assert.equal((await waiting.json()).approvalStatus, "pending");
  assert.equal(cookieFrom(waiting), null);
  const fixture = new Database(path.join(stateDir, "test.db"));
  fixture.prepare("UPDATE adults SET approval_status = 'approved' WHERE email = ?").run("it@example.com");
  fixture.close();
  const approved = await signIn();
  assert.equal(approved.status, 200);
  cookie = cookieFrom(approved);
  assert.ok(cookie, "session cookie set");
});

test("parent academic access is read-only even for direct API requests", async () => {
  for (const [route, method] of [["/api/profiles", "POST"], ["/api/profiles/unknown", "PATCH"], ["/api/profiles/unknown", "DELETE"], ["/api/progress", "POST"], ["/api/assignments", "POST"], ["/api/assignments", "PATCH"]]) {
    const response = await fetch(`${BASE}${route}`, { method, headers: { "Content-Type": "application/json", cookie }, body: "{}" });
    assert.equal(response.status, 403, `${method} ${route}`);
  }
  assert.equal((await fetch(`${BASE}/api/profiles`, { headers: { cookie } })).status, 200);
});

test("approved staff profile, progress and export round-trip", async () => {
  const fixture = new Database(path.join(stateDir, "test.db"));
  fixture.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run("it@example.com");
  fixture.close();
  const created = await fetch(`${BASE}/api/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ displayName: "Nila", ageBand: "6-8", homeLanguages: ["Bangla"] }),
  });
  assert.equal(created.status, 201);
  profileId = (await created.json()).profile.id;

  const progress = await fetch(`${BASE}/api/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      profileId,
      lessonId: "hello-me",
      sessionId: "session-hello-me-listening",
      skill: "listening",
      score: 88,
    }),
  });
  assert.equal(progress.status, 201);

  const exported = await fetch(`${BASE}/api/account/export`, { headers: { cookie } });
  assert.equal(exported.status, 200);
  const payload = await exported.json();
  assert.equal(payload.learnerProfiles.length, 1);
  assert.equal(payload.learnerProfiles[0].progress.length, 1);
  assert.equal(payload.learnerProfiles[0].progress[0].score, 88);
});

test("learner profiles list the most recently created or edited first", async () => {
  const headers = { "Content-Type": "application/json", cookie };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
  const create = async (displayName) => {
    const response = await fetch(`${BASE}/api/profiles`, { method: "POST", headers, body: JSON.stringify({ displayName }) });
    assert.equal(response.status, 201);
    return (await response.json()).profile;
  };
  const rafi = await create("Rafi");
  assert.match(rafi.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(rafi.updatedAt, rafi.createdAt);
  await pause();
  const edited = await fetch(`${BASE}/api/profiles/${rafi.id}`, { method: "PATCH", headers, body: JSON.stringify({ displayName: "Rafi (renamed)" }) });
  assert.equal(edited.status, 200);
  await pause();
  const nadia = await create("Nadia");

  const listed = await (await fetch(`${BASE}/api/profiles`, { headers: { cookie } })).json();
  assert.deepEqual(listed.profiles.map((profile) => profile.displayName), ["Nadia", "Rafi (renamed)", "Nila"]);
  for (const { id } of [rafi, nadia]) assert.equal((await fetch(`${BASE}/api/profiles/${id}`, { method: "DELETE", headers: { cookie } })).status, 200);
});

test("recovery code resets the password and consumes the code", async () => {
  const recovered = await fetch(`${BASE}/api/auth/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "it@example.com",
      recoveryCode: recoveryCodes[0],
      newPassword: "recovered-pass-1",
    }),
  });
  assert.equal(recovered.status, 200);
  const newCookie = cookieFrom(recovered);
  assert.ok(newCookie);

  // Old session was destroyed by the reset.
  const staleSession = await fetch(`${BASE}/api/profiles`, { headers: { cookie } });
  assert.equal(staleSession.status, 401);
  cookie = newCookie;

  // Old password no longer works; new one does.
  const oldPassword = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "it@example.com", password: "integration-pass-1" }),
  });
  assert.equal(oldPassword.status, 401);

  // The same code cannot be used twice.
  const reused = await fetch(`${BASE}/api/auth/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "it@example.com",
      recoveryCode: recoveryCodes[0],
      newPassword: "another-pass-12",
    }),
  });
  assert.equal(reused.status, 401);
});

test("profile deletion removes its progress", async () => {
  const removed = await fetch(`${BASE}/api/profiles/${profileId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(removed.status, 200);

  const exported = await fetch(`${BASE}/api/account/export`, { headers: { cookie } });
  const payload = await exported.json();
  assert.equal(payload.learnerProfiles.length, 0);
});

test("worksheets render for every lesson entry point", async () => {
  const index = await fetch(`${BASE}/worksheets`, { headers: { cookie } });
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  assert.ok(indexHtml.includes("worksheet"), "index mentions worksheets");

  const sheet = await fetch(`${BASE}/worksheets/hello-me`, { headers: { cookie } });
  assert.equal(sheet.status, 200);
  const sheetHtml = await sheet.text();
  assert.ok(sheetHtml.includes("Words to learn"), "vocabulary section present");
  assert.ok(sheetHtml.includes("Family mission"), "family mission present");

  const missing = await fetch(`${BASE}/worksheets/not-a-lesson`, { headers: { cookie } });
  assert.equal(missing.status, 404);
});

test("adult and student logout keep redirects relative behind a reverse proxy", async () => {
  for (const [route, destination] of [["auth", "/grown-ups"], ["student", "/student"]]) {
    const response = await fetch(`${BASE}/api/${route}/sign-out?returnTo=${encodeURIComponent(destination)}`, {
      redirect: "manual",
      headers: { "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "https" },
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), destination);
    assert.match(response.headers.get("set-cookie"), /max-age=0/i);
  }
});

test("sign-out rejects off-origin returnTo, including the backslash bypass", async () => {
  for (const evil of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
    const response = await fetch(
      `${BASE}/api/auth/sign-out?returnTo=${encodeURIComponent(evil)}`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 303);
    const location = response.headers.get("location");
    const target = new URL(location, BASE);
    assert.ok(
      target.hostname === "127.0.0.1" || target.hostname === "localhost",
      `must not redirect off-origin for ${evil}, got ${location}`,
    );
  }
});

test("account deletion removes access entirely", async () => {
  const deleted = await fetch(`${BASE}/api/account/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ password: "recovered-pass-1" }),
  });
  assert.equal(deleted.status, 200);

  const signIn = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "it@example.com", password: "recovered-pass-1" }),
  });
  assert.equal(signIn.status, 401);
});
