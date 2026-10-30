import assert from "node:assert/strict";
import test from "node:test";
import { allowedDuringPasswordChange, cacheControl, isPublicPath, loginDestination, learningReturnPath, passwordChangeDestination, passwordChangeReturnPath } from "../lib/learning-policy.ts";

const url = (path) => new URL(path, "https://school.example");

test("only welcome, authentication, health and limited presentation assets are public", () => {
  for (const path of ["/welcome", "/grown-ups", "/student", "/safety", "/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/recover", "/api/student/sign-in", "/api/student/sign-up", "/api/health", "/sw.js", "/favicon.svg", "/hero-quest-map.webp", "/robots.txt", "/manifest.webmanifest", "/favicon.ico", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]) assert.equal(isPublicPath(url(path)), true, path);
  for (const path of ["/", "/learn", "/stories", "/topics", "/worksheets/hello-me", "/books", "/library", "/classroom", "/audio/hello-bn.ogg", "/api/library", "/api/audio/hello-me/dialogue", "/api/classroom/feed", "/api/auth/not-public", "/river-story.png", "/hero-quest-map.png", "/_next/static/chunks/app/page-secret.js"]) assert.equal(isPublicPath(url(path)), false, path);
});

test("hashed build files and public images are cached, pages, data and gated files are not", () => {
  const environment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(cacheControl("/_next/static/css/15730e9f7c5c55ef.css", "public"), "public, max-age=31536000, immutable");
    assert.equal(cacheControl("/_next/static/media/22a5144ee8d83bca-s.p.woff2", "public"), "public, max-age=31536000, immutable");
    assert.equal(cacheControl("/_next/static/chunks/app/adventure/page-1a2b.js", "signed-in"), "private, max-age=31536000, immutable", "gated scripts stay out of shared caches");
    for (const path of ["/hero-quest-map.webp", "/favicon.svg", "/manifest.webmanifest", "/robots.txt", "/apple-touch-icon.png"]) assert.equal(cacheControl(path, "public"), "public, max-age=86400", path);
    assert.equal(cacheControl("/sw.js", "public"), "no-cache", "a new service worker is picked up on the next load");
    for (const path of ["/welcome", "/api/health", "/api/auth/session"]) assert.equal(cacheControl(path, "public"), "private, no-store", path);
    for (const path of ["/", "/learn", "/api/curriculum", "/audio/hello-bn.ogg", "/river-story.png", "/_next/image"]) assert.equal(cacheControl(path, "signed-in"), "private, no-store", path);
    process.env.NODE_ENV = "development";
    assert.equal(cacheControl("/_next/static/chunks/app/page.js", "signed-in"), "private, no-store", "development file names are reused");
    assert.equal(cacheControl("/_next/static/css/app/layout.css", "public"), "private, no-store");
  } finally {
    if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
  }
});

test("redirects preserve local destinations without trusting origins", () => {
  assert.equal(loginDestination("/stories?book=1"), "/welcome?returnTo=%2Fstories%3Fbook%3D1");
  assert.equal(loginDestination("/teach"), "/grown-ups?returnTo=%2Fteach");
  assert.equal(loginDestination("/family"), "/grown-ups?returnTo=%2Ffamily");
  assert.equal(learningReturnPath("//other.example"), "/");
  assert.equal(learningReturnPath("/\\other.example"), "/");
  assert.equal(learningReturnPath("/.//evil.com"), "/");
  assert.equal(learningReturnPath("/%2e%2e//evil.com/x"), "/");
  assert.equal(loginDestination("/.//evil.com"), "/welcome?returnTo=%2F");
  assert.equal(learningReturnPath("/api/auth/sign-out"), "/");
  assert.equal(learningReturnPath("/student?returnTo=/student"), "/");
  assert.equal(learningReturnPath("/welcome"), "/");
  assert.equal(learningReturnPath("/stories?book=1"), "/stories?book=1");
});

test("an administrator-issued password opens only the change form and its API", () => {
  for (const path of ["/account/password", "/account/password/", "/api/account/password"]) assert.equal(allowedDuringPasswordChange(path), true, path);
  for (const path of ["/account", "/account/passwords", "/teach", "/admin", "/family", "/api/classes", "/api/account/recovery-codes", "/api/account/delete", "/api/admin/users", "/"]) assert.equal(allowedDuringPasswordChange(path), false, path);
});

test("the change form returns only to safe pages, never to itself or an API", () => {
  assert.equal(passwordChangeDestination("/teach"), "/account/password?returnTo=%2Fteach");
  assert.equal(passwordChangeDestination("/admin/results?class=1"), "/account/password?returnTo=%2Fadmin%2Fresults%3Fclass%3D1");
  assert.equal(passwordChangeReturnPath("/account/password?returnTo=/teach"), "/");
  assert.equal(passwordChangeReturnPath("/api/classes"), "/");
  assert.equal(passwordChangeReturnPath("//evil.example"), "/");
  assert.equal(passwordChangeReturnPath("/.//evil.com"), "/");
  assert.equal(passwordChangeDestination("/.//evil.com"), "/account/password?returnTo=%2F");
  assert.equal(passwordChangeReturnPath("/grown-ups"), "/");
  assert.equal(passwordChangeReturnPath(undefined), "/");
  assert.equal(passwordChangeReturnPath("/family"), "/family");
});
