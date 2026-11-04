import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

/**
 * A production server with PUBLIC_ORIGIN written the way a host's settings page may leave it (spaces, capitals,
 * the default port, a trailing slash). Browser requests from that address pass the origin check behind a proxy that
 * rewrote Host and dropped the protocol, a browser sent to the server under another name does not, and redirects
 * stay root-relative.
 */

const PORT = 3264;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-public-origin-"));
let server, serverErrors = "";

/** A request as a reverse proxy passes it on, with the Host header it chose (fetch always sends the real one). */
const proxied = (route, headers, body) => new Promise((resolve, reject) => {
  const request = http.request(`${BASE}${route}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } }, (response) => {
    let text = "";
    response.setEncoding("utf8").on("data", (chunk) => { text += chunk; }).on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
  });
  request.on("error", reject).end(body === undefined ? undefined : JSON.stringify(body));
});
const signIn = { email: "nobody@example.com", password: "not-the-password" };
const behindProxy = { host: "app-svc:3000", "x-forwarded-for": "public-origin" };

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", PUBLIC_ORIGIN: "  https://Learn.Example.ORG:443/  ", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.setEncoding("utf8").on("data", (chunk) => { serverErrors += chunk; });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a browser on the public address passes the origin check, whatever Host the proxy sent", async () => {
  for (const site of [{ "sec-fetch-site": "same-origin" }, {}]) {
    const response = await proxied("/api/auth/sign-in", { ...behindProxy, ...site, origin: "https://learn.example.org" }, signIn);
    assert.equal(response.status, 401, `the sign-in route answered ${JSON.stringify(site)}`);
  }
  assert.doesNotMatch(serverErrors, /PUBLIC_ORIGIN/, "the address was understood");
});

test("a browser that reached the server under another name is refused, even though it calls itself same-origin", async () => {
  for (const origin of ["http://app-svc:3000", "https://rebound.example"]) {
    const response = await proxied("/api/auth/sign-in", { ...behindProxy, origin, "sec-fetch-site": "same-origin" }, signIn);
    assert.equal(response.status, 403, origin);
    assert.equal(JSON.parse(response.text).error, "The request origin could not be verified.", origin);
  }
});

test("redirects are root-relative, not built from PUBLIC_ORIGIN or the internal address", async () => {
  for (const [route, expected] of [["/", "/welcome"], ["/classroom", "/student"]]) {
    const response = await proxied(route, behindProxy);
    assert.equal(response.status, 307, route);
    assert.equal(response.headers.location, expected, route);
  }
});
