/** Raw HTTP transport for private staging. No TCP listener and no application data access. */
import net from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function removeStaleSocket(socketPath) {
  let before;
  try { before = await lstat(socketPath); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!before.isSocket() || before.isSymbolicLink()) throw new Error("The staging socket path is not a Unix socket.");
  const active = await new Promise((resolve, reject) => {
    const probe = net.createConnection(socketPath);
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", (error) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") resolve(false);
      else reject(error);
    });
  });
  if (active) throw new Error("The staging socket already has an active listener.");
  const after = await lstat(socketPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (!after) return;
  if (!after.isSocket() || before.ino !== after.ino || before.dev !== after.dev) throw new Error("The staging socket changed during inspection.");
  await unlink(socketPath);
}

export async function startPrivateStagingProxy({ socketPath, targetHost, targetPort }) {
  if (!socketPath?.startsWith("/") || !targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error("Invalid staging proxy configuration.");
  await removeStaleSocket(socketPath);
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const upstream = net.createConnection({ host: targetHost, port: targetPort, allowHalfOpen: true });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    }
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  server.maxConnections = 128;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try { await chmod(socketPath, 0o666); } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  const close = () => new Promise((resolve) => {
    const timer = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 5000);
    timer.unref();
    server.close(() => { clearTimeout(timer); resolve(); });
  });
  return { server, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startPrivateStagingProxy({ socketPath: "/runtime/http.sock", targetHost: "app", targetPort: 3000 }).then(({ server, close }) => {
    let closing = false;
    const finish = () => { if (!closing) { closing = true; void close().then(() => process.exit(process.exitCode || 0)); } };
    process.once("SIGTERM", finish);
    process.once("SIGINT", finish);
    server.on("error", () => { console.error("private staging proxy: listener failed."); process.exitCode = 1; finish(); });
    console.log("private staging proxy: listening on the private Unix socket.");
  }).catch(() => { console.error("private staging proxy: could not create the private Unix listener."); process.exitCode = 1; });
}
