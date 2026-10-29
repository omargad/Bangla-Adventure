import assert from "node:assert/strict";
import test from "node:test";
import { allowedDuringPasswordChange, isPublicPath, loginDestination, learningReturnPath, passwordChangeDestination, passwordChangeReturnPath } from "../lib/learning-policy.ts";

const url = (path) => new URL(path, "https://school.example");

test("only welcome, authentication, health and limited presentation assets are public", () => {
  for (const path of ["/welcome", "/grown-ups", "/student", "/safety", "/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/recover", "/api/student/sign-in", "/api/student/sign-up", "/api/health", "/sw.js", "/favicon.svg", "/hero-quest-map.png"]) assert.equal(isPublicPath(url(path)), true, path);
  for (const path of ["/", "/learn", "/stories", "/topics", "/worksheets/hello-me", "/books", "/library", "/classroom", "/audio/hello-bn.ogg", "/api/library", "/api/audio/hello-me/dialogue", "/api/classroom/feed", "/api/auth/not-public", "/river-story.png", "/_next/static/chunks/app/page-secret.js"]) assert.equal(isPublicPath(url(path)), false, path);
});

test("redirects preserve local destinations without trusting origins", () => {
  assert.equal(loginDestination("/stories?book=1"), "/welcome?returnTo=%2Fstories%3Fbook%3D1");
  assert.equal(loginDestination("/teach"), "/grown-ups?returnTo=%2Fteach");
  assert.equal(loginDestination("/family"), "/grown-ups?returnTo=%2Ffamily");
  assert.equal(learningReturnPath("//other.example"), "/");
  assert.equal(learningReturnPath("/\\other.example"), "/");
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
  assert.equal(passwordChangeReturnPath("/grown-ups"), "/");
  assert.equal(passwordChangeReturnPath(undefined), "/");
  assert.equal(passwordChangeReturnPath("/family"), "/family");
});
