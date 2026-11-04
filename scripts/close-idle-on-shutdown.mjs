// Loaded with `node --import` before Next starts. On a stop, Next closes its server and waits for every
// connection to end. Connections kept open between requests (--keepAliveTimeout) would hold that
// wait for minutes, past the host's grace period, so once closing has begun each connection is
// closed as soon as it has no request in progress.
import http from "node:http";

const close = http.Server.prototype.close;
http.Server.prototype.close = function closeAndDrain(...args) {
  const timer = setInterval(() => this.closeIdleConnections(), 100);
  timer.unref();
  this.once("close", () => clearInterval(timer));
  return close.apply(this, args);
};
