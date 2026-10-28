import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("service worker never intercepts private pages, API data or RSC payloads", () => {
  const handlers = new Map();
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin: "https://school.example" }, addEventListener: (name, handler) => handlers.set(name, handler) },
    URL,
  });
  for (const pathname of ["/", "/learn", "/stories", "/audio/hello-bn.ogg", "/_next/static/chunks/learning.js", "/admin", "/admin/users", "/teach", "/family", "/studio", "/account", "/student", "/classroom", "/grown-ups", "/api/admin/users", "/api/auth/sign-in"]) {
    let intercepted = false;
    handlers.get("fetch")?.({ request: new Request(`https://school.example${pathname}`), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, pathname);
  }
  let intercepted = false;
  handlers.get("fetch")?.({ request: new Request("https://school.example/?_rsc=test", { headers: { rsc: "1" } }), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
