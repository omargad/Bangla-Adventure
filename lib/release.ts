import { readFileSync } from "node:fs";
import path from "node:path";

let cached: string | undefined;

/**
 * The id `next build` gave the running build, read once from `<distDir>/BUILD_ID`. Open pages compare it
 * with /api/auth/session to reload after a deploy. "development" when there is no build (`next dev`).
 */
export function currentRelease(): string {
  if (cached === undefined) {
    try {
      cached = readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next", "BUILD_ID"), "utf8").trim() || "development";
    } catch {
      cached = "development";
    }
  }
  return cached;
}
