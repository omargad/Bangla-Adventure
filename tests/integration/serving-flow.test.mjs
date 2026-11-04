import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * How the production server serves files: which responses a browser may keep and for how long, the
 * icons and robots.txt anyone may load, the security headers on every kind of response, and the
 * release id that tells open pages a new build is live.
 */

const PORT = 3274;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL("../..", import.meta.url).pathname;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-serving-"));
const password = "integration-serving-password";
const YEAR_PUBLIC = "public, max-age=31536000, immutable";
const YEAR_PRIVATE = "private, max-age=31536000, immutable";
let server, studentCookie;

const send = (route, cookie, init = {}) => fetch(`${BASE}${route}`, { redirect: "manual", ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
const json = (route, body, headers = {}) => send(route, undefined, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "serving-student", ...headers }, body: JSON.stringify(body) });
const assets = (html, pattern) => [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((match) => match[1]).filter((src) => pattern.test(src));
const renderedRelease = (html) => /\\"release\\":\\"([^"\\]+)\\"/.exec(html)?.[1];
/** A request as a reverse proxy passes it on, with the Host header it chose (fetch always sends the real one). */
const proxied = (route, headers, body) => new Promise((resolve, reject) => {
  const request = http.request(`${BASE}${route}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } }, (response) => {
    let text = "";
    response.setEncoding("utf8").on("data", (chunk) => { text += chunk; }).on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
  });
  request.on("error", reject).end(body === undefined ? undefined : JSON.stringify(body));
});

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal((await json("/api/student/sign-up", { username: "serving-mina", displayName: "Mina", password })).status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  const db = new Database(path.join(stateDir, "test.db"));
  try { db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run("serving-mina"); } finally { db.close(); }
  const signedIn = await json("/api/student/sign-in", { username: "serving-mina", password });
  assert.equal(signedIn.status, 200);
  studentCookie = signedIn.headers.getSetCookie().find((value) => value.startsWith("ba_student_session="))?.split(";")[0];
  assert.ok(studentCookie);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("hashed build files are cached for a year, gated ones only in the signed-in browser", async () => {
  const welcome = await (await send("/welcome")).text();
  const [css] = assets(welcome, /\.css$/);
  assert.ok(css, "the welcome page links its stylesheet");
  const style = await send(css);
  assert.equal(style.status, 200);
  assert.equal(style.headers.get("cache-control"), YEAR_PUBLIC);
  assert.equal(style.headers.get("x-content-type-options"), "nosniff");

  const adventure = await send("/adventure", studentCookie);
  assert.equal(adventure.status, 200);
  const [gated] = assets(await adventure.text(), /\/app\/adventure\/page-[^/]+\.js$/);
  assert.ok(gated, "the adventure page loads its own script");
  const signedIn = await send(gated, studentCookie);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get("cache-control"), YEAR_PRIVATE);
  const signedOut = await send(gated);
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await signedOut.json(), { error: "Sign in to access learning content." });

  const missing = await send("/_next/static/chunks/app/adventure/page-0000000000000000.js", studentCookie);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control"), /no-store/, "a missing build file is not kept");
});

test("public images keep for a day, the service worker is rechecked and pages, data and gated files are never stored", async () => {
  const hero = await send("/hero-quest-map.webp");
  assert.equal(hero.status, 200);
  assert.equal(hero.headers.get("content-type"), "image/webp");
  assert.equal(hero.headers.get("cache-control"), "public, max-age=86400");
  assert.ok(Number(hero.headers.get("content-length")) <= 300_000, "the hero image stays small");
  assert.equal((await send("/hero-quest-map.png")).status, 401, "the old 2.9 MB image is gone");
  for (const html of [await (await send("/welcome")).text(), await (await send("/adventure", studentCookie)).text()]) {
    assert.ok(html.includes('src="/hero-quest-map.webp"'), "the hero uses the WebP image");
  }

  const worker = await send("/sw.js");
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get("cache-control"), "no-cache");

  for (const [route, cookie] of [["/welcome"], ["/adventure", studentCookie], ["/api/health"], ["/api/curriculum", studentCookie], ["/audio/hello-bn.ogg", studentCookie]]) {
    const response = await send(route, cookie);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("cache-control"), "private, no-store", route);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", route);
  }
});

test("the adventure page's pictures are small WebP files kept a day only in the signed-in browser", async () => {
  const html = await (await send("/adventure", studentCookie)).text();
  for (const route of ["/river-story.webp", "/postcard-collage.webp"]) {
    assert.ok(html.includes(`src="${route}"`), `the adventure page uses ${route}`);
    const signedIn = await send(route, studentCookie);
    assert.equal(signedIn.status, 200, route);
    assert.equal(signedIn.headers.get("content-type"), "image/webp", route);
    assert.equal(signedIn.headers.get("cache-control"), "private, max-age=86400", route);
    assert.ok(Number(signedIn.headers.get("content-length")) <= 300_000, `${route} stays small`);
    const signedOut = await send(route);
    assert.equal(signedOut.status, 401, route);
    assert.equal(signedOut.headers.get("cache-control"), "private, no-store", route);
  }
  for (const route of ["/river-story.png", "/postcard-collage.png"]) {
    const old = await send(route, studentCookie);
    assert.equal(old.status, 404, `the old 3 MB ${route} is gone`);
    assert.match(old.headers.get("cache-control"), /no-store/, route);
  }
});

test("robots.txt and the icons load without signing in", async () => {
  const png = async (route, size) => {
    const response = await send(route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("content-type"), "image/png", route);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", route);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [size, size], route);
  };
  await png("/apple-touch-icon.png", 180);
  await png("/icon-192.png", 192);
  await png("/icon-512.png", 512);
  await png("/icon-maskable-512.png", 512);

  const favicon = await send("/favicon.ico");
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /^image\/(x-icon|vnd\.microsoft\.icon)$/);
  const ico = Buffer.from(await favicon.arrayBuffer());
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 2], "an icon file with two images");
  assert.deepEqual([ico[6], ico[22]].sort(), [32, 48]);

  const robots = await send("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  const rules = await robots.text();
  for (const page of ["/welcome", "/safety", "/grown-ups"]) assert.ok(rules.includes(`Allow: ${page}\n`), page);
  assert.match(rules, /^Disallow: \/$/m);

  const manifest = await send("/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  const { icons } = await manifest.json();
  assert.deepEqual(icons.map(({ src, purpose }) => [src, purpose]), [["/favicon.svg", "any"], ["/icon-192.png", "any"], ["/icon-512.png", "any"], ["/icon-maskable-512.png", "maskable"]]);
  for (const { src } of icons) assert.equal((await send(src)).status, 200, src);
  assert.ok((await (await send("/welcome")).text()).includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>'));
});

test("pages, API data, proxy errors and proxy redirects carry the security headers", async () => {
  const responses = {
    page: await send("/welcome"),
    api: await send("/api/health"),
    "proxy 401": await send("/api/curriculum"),
    "proxy redirect": await send("/learn"),
    "proxy 403": await send("/api/auth/sign-in", undefined, { method: "POST", headers: { origin: "https://elsewhere.example", "Content-Type": "application/json" }, body: "{}" }),
    "proxy 410": await send("/api/classroom/feed"),
  };
  assert.deepEqual(Object.values(responses).map((response) => response.status), [200, 200, 401, 307, 403, 410]);
  for (const [kind, response] of Object.entries(responses)) {
    assert.equal(response.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains", kind);
    assert.equal(response.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(self)", kind);
    assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'", kind);
    assert.equal(response.headers.get("x-frame-options"), "DENY", kind);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", kind);
    assert.equal(response.headers.get("x-powered-by"), null, kind);
  }
});

test("the release is the build id, the same in /api/auth/session and in every page", async () => {
  const buildId = readFileSync(path.join(ROOT, process.env.NEXT_DIST_DIR ?? ".next", "BUILD_ID"), "utf8").trim();
  assert.notEqual(buildId, "development");
  assert.equal((await (await send("/api/auth/session")).json()).release, buildId);
  assert.equal((await (await send("/api/auth/session", studentCookie)).json()).release, buildId);
  assert.equal(renderedRelease(await (await send("/welcome")).text()), buildId);
  assert.equal(renderedRelease(await (await send("/adventure", studentCookie)).text()), buildId);
});

test("behind a proxy that keeps no Host or protocol, redirects stay on the address the browser used", async () => {
  const proxies = [
    { host: "learn.example.org" },
    { host: "app-svc:3000", "x-forwarded-host": "learn.example.org" },
    { host: "app-svc:3000", "x-forwarded-host": "learn.example.org", "x-forwarded-proto": "https" },
  ];
  for (const headers of proxies) {
    for (const [route, expected] of [["/", "/welcome"], ["/learn", "/welcome?returnTo=%2Flearn"], ["/teach/classes?tab=1", "/grown-ups?returnTo=%2Fteach%2Fclasses%3Ftab%3D1"], ["/classroom", "/student"]]) {
      const { status, headers: answer } = await proxied(route, headers);
      const where = `${route} via ${JSON.stringify(headers)}`;
      assert.equal(status, 307, where);
      assert.equal(answer.location, expected, where);
      assert.doesNotMatch(answer.location, /127\.0\.0\.1|localhost|app-svc|:\d/, where);
    }
  }
});

test("without PUBLIC_ORIGIN, a browser's same-origin answer gets through a proxy that rewrote Host", async () => {
  const signIn = { email: "nobody@example.com", password: "not-the-password" };
  const behindProxy = { host: "app-svc:3000", origin: "https://learn.example.org", "x-forwarded-for": "serving-proxy" };
  const accepted = await proxied("/api/auth/sign-in", { ...behindProxy, "sec-fetch-site": "same-origin" }, signIn);
  assert.equal(accepted.status, 401, "the sign-in route answered, not the origin check");
  const unverified = await proxied("/api/auth/sign-in", behindProxy, signIn);
  assert.equal(unverified.status, 403, "a browser without Sec-Fetch-Site is checked on Origin alone");
  assert.equal(JSON.parse(unverified.text).error, "The request origin could not be verified.");
  for (const site of ["same-site", "cross-site"]) {
    const refused = await proxied("/api/auth/sign-in", { ...behindProxy, "sec-fetch-site": site }, signIn);
    assert.equal(refused.status, 403, site);
    assert.equal(JSON.parse(refused.text).error, "Cross-site requests are not allowed.", site);
  }
});

test("signing in from a plain http:// address on another computer says why instead of dropping the cookie", async () => {
  const lan = { host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000", "sec-fetch-site": "same-origin", "x-forwarded-for": "serving-lan" };
  for (const [route, body] of [
    ["/api/auth/sign-in", { email: "nobody@example.com", password: "not-the-password" }],
    ["/api/auth/recover", { email: "nobody@example.com", recoveryCode: "AAAA-BBBB", newPassword: "a-long-new-password" }],
    ["/api/student/sign-in", { username: "serving-mina", password }],
  ]) {
    const response = await proxied(route, lan, body);
    assert.equal(response.status, 400, route);
    assert.deepEqual(JSON.parse(response.text), { error: "Signing in needs a secure https:// address.", errorBn: "সাইন ইন করতে নিরাপদ https:// ঠিকানা প্রয়োজন।" }, route);
    assert.equal(response.headers["set-cookie"], undefined, route);
  }
  const local = await proxied("/api/student/sign-in", { ...lan, host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` }, { username: "serving-mina", password });
  assert.equal(local.status, 200, "this computer's own address still signs in");
});
