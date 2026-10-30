import type { NextConfig } from "next";
import { normalizeMoodleUrl, retiredLmsApiPrefixes, retiredLmsPages } from "./lib/moodle-mode";

const platformMode = process.env.PLATFORM_MODE ?? "legacy";
const moodleUrl = normalizeMoodleUrl(process.env.MOODLE_URL ?? process.env.NEXT_PUBLIC_MOODLE_URL);

if (platformMode === "moodle" && !moodleUrl) {
  throw new Error("PLATFORM_MODE=moodle requires MOODLE_URL or NEXT_PUBLIC_MOODLE_URL.");
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: { cpus: 2 },
  images: { unoptimized: true },
  poweredByHeader: false,
  // Next also applies these to the responses proxy.ts returns itself (401, 403, 410 and redirects).
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      // Lessons record from the microphone in the page itself; embedded videos get no device access.
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
      // No script-src: Next's inline bootstrap scripts would need per-request nonces.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
    ] }];
  },
  allowedDevOrigins: ["31.56.120.148"],
  serverExternalPackages: ["better-sqlite3"],
  async redirects() {
    if (platformMode !== "moodle") return [];
    return retiredLmsPages.map((source) => ({
      source,
      destination: moodleUrl,
      permanent: false,
    }));
  },
  async rewrites() {
    if (platformMode !== "moodle") return [];
    return {
      beforeFiles: retiredLmsApiPrefixes.map((prefix) => ({
        source: `/api/${prefix}/:path*`,
        destination: "/api/lms-retired",
      })),
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
