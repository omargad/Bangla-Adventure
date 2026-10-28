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
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
