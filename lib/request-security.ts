export function validateMutation(request: Request, configuredOrigin?: string): string | null {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const logout = new URL(request.url).pathname.endsWith("/sign-out");
  if (!mutation && !logout) return null;
  if (request.headers.get("sec-fetch-site") === "cross-site") return "Cross-site requests are not allowed.";
  const origin = request.headers.get("origin");
  const expected = configuredOrigin ?? new URL(request.url).origin;
  if (origin && origin !== expected) return "The request origin could not be verified.";
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json" && !(type === "multipart/form-data" && origin === expected)) {
      return "Send JSON or a same-origin upload.";
    }
  }
  return null;
}
