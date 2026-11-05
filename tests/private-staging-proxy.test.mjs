import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { mkdtemp, writeFile, symlink, lstat, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { startPrivateStagingProxy } from "../scripts/private-staging-proxy.mjs";

async function unixFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bangla-proxy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const socketPath = path.join(root, "http.sock");
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(socketPath, resolve); });
    await new Promise((resolve) => probe.close(resolve));
  } catch (error) {
    if (!process.env.CI && ["EPERM", "EACCES", "EAFNOSUPPORT"].includes(error.code)) {
      t.skip(`Local executor cannot bind AF_UNIX (${error.code}); this real transport test is mandatory in CI.`);
      return null;
    }
    throw error;
  }
  return { root, socketPath };
}

test("proxy rejects malformed configuration without opening a listener", async () => {
  await assert.rejects(startPrivateStagingProxy({ socketPath: "relative.sock", targetHost: "app", targetPort: 3000 }), /Invalid/);
  await assert.rejects(startPrivateStagingProxy({ socketPath: "/tmp/unused.sock", targetHost: "app", targetPort: 0 }), /Invalid/);
});

test("proxy refuses regular files and symlinks without unlinking their targets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bangla-proxy-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const regular = path.join(root, "file"), linked = path.join(root, "linked");
  await writeFile(regular, "preserve me");
  await symlink(regular, linked);
  for (const socketPath of [regular, linked]) await assert.rejects(startPrivateStagingProxy({ socketPath, targetHost: "127.0.0.1", targetPort: 9 }), /not a Unix socket/);
  assert.equal(await readFile(regular, "utf8"), "preserve me");
  assert.ok((await lstat(linked)).isSymbolicLink());
});

test("real Unix transport preserves HTTP bytes and Host, publishes no TCP listener and cleans up", async (t) => {
  const fixture = await unixFixture(t);
  if (!fixture) return;
  let seen = "";
  const upstream = net.createServer((connection) => {
    connection.on("data", (chunk) => {
      seen += chunk.toString();
      if (seen.includes("\r\n\r\n") && seen.endsWith("hello")) connection.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
    });
  });
  await new Promise((resolve, reject) => { upstream.once("error", reject); upstream.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const proxy = await startPrivateStagingProxy({ socketPath: fixture.socketPath, targetHost: "127.0.0.1", targetPort: upstream.address().port });
  t.after(() => proxy.close());
  assert.equal(proxy.server.address(), fixture.socketPath, "listener is a Unix path, never a host TCP address");
  assert.equal((await lstat(fixture.socketPath)).mode & 0o777, 0o666);
  const client = net.createConnection(fixture.socketPath);
  await once(client, "connect");
  let received = "";
  client.on("data", (chunk) => { received += chunk.toString(); });
  const done = once(client, "end");
  const request = "POST /api/example HTTP/1.1\r\nHost: 127.0.0.1:3001\r\nOrigin: http://127.0.0.1:3001\r\nContent-Length: 5\r\n\r\nhello";
  client.write(request);
  await done;
  client.destroy();
  assert.equal(seen, request);
  assert.match(received, /200 OK[\s\S]*OK$/);
  await proxy.close();
  await assert.rejects(lstat(fixture.socketPath), { code: "ENOENT" });
});

test("an active Unix listener is never unlinked or replaced", async (t) => {
  const fixture = await unixFixture(t);
  if (!fixture) return;
  const active = net.createServer((connection) => connection.end());
  await new Promise((resolve) => active.listen(fixture.socketPath, resolve));
  t.after(() => new Promise((resolve) => active.close(resolve)));
  const inode = (await lstat(fixture.socketPath)).ino;
  await assert.rejects(startPrivateStagingProxy({ socketPath: fixture.socketPath, targetHost: "app", targetPort: 3000 }), /active listener/);
  assert.equal((await lstat(fixture.socketPath)).ino, inode);
});
